import * as path from 'node:path';
import * as fs from 'node:fs';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';

const REPO_ROOT = path.resolve(__dirname, '../..');
const CONTENT_DIR = path.join(REPO_ROOT, 'content');
const API_DIST_DIR = path.join(REPO_ROOT, 'services/api/dist');
const DEFAULT_BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

export class ContextCueStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ---------------------------------------------------------------------
    // Content bucket: titles.json + subtitles, served to the Lambda at
    // runtime via CONTENT_BUCKET. Video is intentionally excluded — it's
    // downloaded separately (see /content README) and never uploaded here.
    // ---------------------------------------------------------------------
    const contentBucket = new s3.Bucket(this, 'ContentBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED
    });

    if (fs.existsSync(CONTENT_DIR)) {
      new s3deploy.BucketDeployment(this, 'ContentDeployment', {
        sources: [
          s3deploy.Source.asset(CONTENT_DIR, {
            exclude: ['video', 'video/**', '**/*.mp4', '**/*.mkv', '**/*.mov']
          })
        ],
        destinationBucket: contentBucket,
        prune: false
      });
    }

    // ---------------------------------------------------------------------
    // Sessions table: 6-char code as the primary key, TTL so companion
    // sessions self-expire after ~12h (enforced in app code, mirrored here).
    // ---------------------------------------------------------------------
    const sessionsTable = new dynamodb.TableV2(this, 'SessionsTable', {
      partitionKey: { name: 'code', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // ---------------------------------------------------------------------
    // API Lambda: pre-bundled by esbuild (services/api/esbuild.config.mjs ->
    // dist/lambda.mjs) rather than NodejsFunction, so `cdk synth` never needs
    // Docker or a network-connected esbuild resolution step.
    // Run `npm run build -w @contextcue/api` before `cdk synth`/`cdk deploy`.
    // ---------------------------------------------------------------------
    if (!fs.existsSync(API_DIST_DIR)) {
      throw new Error(
        `services/api/dist not found at ${API_DIST_DIR}. Run "npm run build -w @contextcue/api" first.`
      );
    }

    // ---------------------------------------------------------------------
    // Optional Bedrock Guardrail for kids-mode content filtering — created
    // only with `-c withGuardrail=true` (off by default: a guardrail is a
    // real, standing resource judges' AWS bills don't need for the default
    // demo path). When present, its id/version are wired into the Lambda's
    // env so BedrockProvider passes `guardrailConfig` on every Converse call.
    // ---------------------------------------------------------------------
    const withGuardrail = ['true', true].includes(this.node.tryGetContext('withGuardrail'));

    let guardrail: bedrock.CfnGuardrail | undefined;
    if (withGuardrail) {
      guardrail = new bedrock.CfnGuardrail(this, 'KidsModeGuardrail', {
        name: 'contextcue-kids-mode',
        blockedInputMessaging: 'This request cannot be processed for a kids-mode viewing session.',
        blockedOutputsMessaging: "I can't share that in kids mode — let's try a different question.",
        contentPolicyConfig: {
          filtersConfig: [
            { type: 'SEXUAL', inputStrength: 'HIGH', outputStrength: 'HIGH' },
            { type: 'VIOLENCE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
            { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
            { type: 'INSULTS', inputStrength: 'HIGH', outputStrength: 'HIGH' },
            { type: 'MISCONDUCT', inputStrength: 'HIGH', outputStrength: 'HIGH' }
          ]
        }
      });
    }

    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'lambda.handler',
      code: lambda.Code.fromAsset(API_DIST_DIR),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      logGroup: new logs.LogGroup(this, 'ApiFunctionLogs', {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      }),
      environment: {
        PROVIDER: 'bedrock',
        BEDROCK_MODEL_ID: DEFAULT_BEDROCK_MODEL_ID,
        // AWS_REGION is set automatically by the Lambda runtime — don't set it here.
        SESSIONS_TABLE: sessionsTable.tableName,
        CONTENT_BUCKET: contentBucket.bucketName,
        SPEECH: 'polly',
        // Prompt caching (Converse cachePoint on the system prompt) defaults
        // to on for Anthropic models in BedrockProvider itself — no env var
        // needed here unless you want to force it on/off; see services/api/README.md.
        ...(guardrail
          ? { BEDROCK_GUARDRAIL_ID: guardrail.attrGuardrailId, BEDROCK_GUARDRAIL_VERSION: 'DRAFT' }
          : {})
      }
    });

    if (guardrail) {
      apiFunction.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['bedrock:ApplyGuardrail'],
          resources: [guardrail.attrGuardrailArn]
        })
      );
    }

    // Bedrock: allow Converse/InvokeModel on both foundation models and
    // cross-region inference profiles (the default model id above is an
    // inference-profile id, e.g. "us.anthropic...").
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:Converse', 'bedrock:ConverseStream'],
        resources: [
          `arn:${this.partition}:bedrock:*::foundation-model/*`,
          `arn:${this.partition}:bedrock:*:${this.account}:inference-profile/*`
        ]
      })
    );

    // Polly: SynthesizeSpeech has no resource-level permissions, only "*".
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['polly:SynthesizeSpeech'],
        resources: ['*']
      })
    );

    sessionsTable.grantReadWriteData(apiFunction);
    contentBucket.grantRead(apiFunction);

    // ---------------------------------------------------------------------
    // HTTP API (API Gateway v2): one $default route forwards everything
    // (/health, /v1/*, /mcp) to the Lambda — routing lives in the Hono app.
    // ---------------------------------------------------------------------
    const integration = new apigwv2Integrations.HttpLambdaIntegration('ApiIntegration', apiFunction);

    const httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      defaultIntegration: integration,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS
        ],
        allowHeaders: ['Content-Type', 'X-TV-Token', 'mcp-session-id', 'mcp-protocol-version', 'Last-Event-ID'],
        exposeHeaders: ['mcp-session-id', 'mcp-protocol-version']
      }
    });

    // ---------------------------------------------------------------------
    // Default-stage throttling: a coarse, cheap backstop against runaway or
    // abusive traffic (this is a hackathon demo API with an open-CORS, open
    // -join-code surface). Configurable via CDK context so a real demo/load
    // test can raise it without a code change:
    //   npx cdk deploy -c throttleRateLimit=50 -c throttleBurstLimit=100
    // See infra/README.md for an optional WAF rate-based rule on top of this.
    // ---------------------------------------------------------------------
    const throttleRateLimit = Number(this.node.tryGetContext('throttleRateLimit') ?? 20);
    const throttleBurstLimit = Number(this.node.tryGetContext('throttleBurstLimit') ?? 40);
    const defaultStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (defaultStage) {
      defaultStage.defaultRouteSettings = {
        throttlingRateLimit: throttleRateLimit,
        throttlingBurstLimit: throttleBurstLimit
      };
    }

    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
    new cdk.CfnOutput(this, 'McpUrl', { value: `${httpApi.apiEndpoint}/mcp` });
    new cdk.CfnOutput(this, 'ContentBucketName', { value: contentBucket.bucketName });
    new cdk.CfnOutput(this, 'SessionsTableName', { value: sessionsTable.tableName });
    if (guardrail) {
      new cdk.CfnOutput(this, 'GuardrailId', { value: guardrail.attrGuardrailId });
    }
  }
}
