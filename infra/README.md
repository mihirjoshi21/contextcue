# ContextCue infra (AWS CDK v2, TypeScript)

Deploys: an S3 content bucket (titles.json + subtitles, video excluded), a DynamoDB sessions
table (pay-per-request, 12h TTL), a single Lambda running the whole `@contextcue/api` Hono app
(including `/mcp`), and an HTTP API (API Gateway v2) in front of it with open CORS.

## Prerequisites

- `npm install` from the repo root (installs `@contextcue/api` + `@contextcue/core`)
- `npm install` inside `infra/` (this directory — it's not an npm workspace, it has its own
  dependency tree so the Lambda's dependencies never leak into the CDK app's)
- AWS credentials (`aws sso login`, or `AWS_PROFILE`) with permission to deploy the resources
  below, and `cdk bootstrap` run once per account/region
- **Build the Lambda bundle first** — the stack fails fast with a clear error if you forget:

  ```bash
  npm run build -w @contextcue/api   # from repo root; writes services/api/dist/lambda.mjs
  ```

  We use a pre-bundled esbuild asset (`lambda.Code.fromAsset('../services/api/dist')`) rather
  than `NodejsFunction`, so `cdk synth`/`deploy` never needs Docker or an on-the-fly bundling
  step — good for a hackathon where the deploy machine may not have Docker running.

## Synth / diff / deploy

```bash
cd infra
npx cdk synth      # verified in this repo with NO AWS credentials — pure template generation
npx cdk diff        # requires credentials
npx cdk deploy      # requires credentials + bootstrap
```

`cdk synth` succeeds standalone (no deploy, no creds needed) — that's the state this repo is
committed in, both with and without the optional guardrail (below). Outputs on deploy: `ApiUrl`
(HTTP API base URL), `McpUrl` (`ApiUrl` + `/mcp`), `ContentBucketName`, `SessionsTableName`, and
`GuardrailId` if the guardrail was provisioned.

### Optional: kids-mode Bedrock Guardrail

```bash
npx cdk synth  -c withGuardrail=true
npx cdk deploy -c withGuardrail=true
```

Off by default (a Guardrail is a standing resource the default demo path doesn't need). With
`withGuardrail=true`, the stack provisions an `AWS::Bedrock::Guardrail` (content filters for
sexual/violence/hate/insults/misconduct, all at `HIGH` strength — meant for a "kids" audience
mode) and wires `BEDROCK_GUARDRAIL_ID`/`BEDROCK_GUARDRAIL_VERSION` (`DRAFT`) into the Lambda's
environment, plus a scoped `bedrock:ApplyGuardrail` grant. `BedrockProvider` (see
`services/api/README.md`) picks these up automatically and passes `guardrailConfig` on every
Converse call.

After deploying, point the Fire TV app / companion at `ApiUrl`, and Alexa+ (or any MCP client)
at `McpUrl`.

## What's provisioned

| Resource | Notes |
| --- | --- |
| S3 `ContentBucket` | `BucketDeployment` of `/content`, **excludes** `video/**` and `*.mp4`/`*.mkv`/`*.mov` — video is never uploaded here, only titles.json + subtitles |
| DynamoDB `SessionsTable` | `TableV2`, on-demand billing, TTL attribute `ttl` (~12h, enforced in app code) |
| Lambda `ApiFunction` | Node.js 22, **ARM64**, 1024MB, 30s timeout, pre-bundled `lambda.mjs` asset |
| HTTP API `HttpApi` | API Gateway v2, single `$default` route → Lambda (all routing happens inside the Hono app), CORS open, default-stage throttled (see below) |
| Bedrock `KidsModeGuardrail` (optional) | `AWS::Bedrock::Guardrail`, only with `-c withGuardrail=true` — see below |

### IAM granted to the Lambda's execution role

- `bedrock:InvokeModel` / `InvokeModelWithResponseStream` / `Converse` / `ConverseStream` on
  both `foundation-model/*` and `inference-profile/*` ARNs (the default model id is a
  cross-region inference profile id, `us.anthropic.claude-haiku-4-5-...`)
- `polly:SynthesizeSpeech` (Polly has no resource-level permissions, so this is `Resource: *`)
- Read/write on the sessions table (`grantReadWriteData`)
- Read on the content bucket (`grantRead`)

### Environment variables set on the Lambda

`PROVIDER=bedrock`, `BEDROCK_MODEL_ID` (inference profile id above), `SESSIONS_TABLE`,
`CONTENT_BUCKET`, `SPEECH=polly`, and (only with `-c withGuardrail=true`)
`BEDROCK_GUARDRAIL_ID`/`BEDROCK_GUARDRAIL_VERSION`. (`AWS_REGION` is set automatically by the
Lambda runtime — CDK will refuse to deploy if you try to set it explicitly, which is why it's not
listed as an explicit env var in the stack. Prompt caching needs no env var at all here — it
defaults on for Anthropic models inside `BedrockProvider` itself.)

### Throttling

The HTTP API's default (`$default`) stage is throttled at the CloudFormation level
(`RouteSettings.ThrottlingRateLimit`/`ThrottlingBurstLimit`) — **20 requests/second sustained, 40
burst** by default. This is a coarse, cheap backstop (not per-client/per-IP — that needs a WAF
rule, below) against a runaway client or a misbehaving demo script. Override at synth/deploy time:

```bash
npx cdk deploy -c throttleRateLimit=50 -c throttleBurstLimit=100
```

#### Optional: AWS WAF rate-based rule

Not provisioned by this stack (a `WebACL` costs money standing, and per-IP rate limiting isn't
needed for a hackathon demo audience) — but if you want real per-source-IP throttling in front of
the HTTP API, associate a `AWS::WAFv2::WebACL` with a `RateBasedStatement`:

```ts
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';

const webAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
  scope: 'REGIONAL',
  defaultAction: { allow: {} },
  visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'ContextCueApiWebAcl' },
  rules: [
    {
      name: 'RateLimitPerIp',
      priority: 0,
      action: { block: {} },
      statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: 'IP' } }, // requests per 5 min per IP
      visibilityConfig: { sampledRequestsEnabled: true, cloudWatchMetricsEnabled: true, metricName: 'RateLimitPerIp' }
    }
  ]
});

new wafv2.CfnWebACLAssociation(this, 'ApiWebAclAssociation', {
  resourceArn: `arn:${this.partition}:apigateway:${this.region}::/apis/${httpApi.httpApiId}/stages/$default`,
  webAclArn: webAcl.attrArn
});
```

`limit: 2000` per 5-minute window per IP is WAF's own rate-based-rule minimum granularity (it
can't go tighter than 5-minute windows) — the CDK-context stage throttle above is still the right
tool for a tighter, simpler global rate limit; WAF is for per-IP abuse protection specifically.

## Generating subtitles for titles that don't have them (Transcribe)

`scripts/transcribe-subtitles.ts` is a standalone helper (not part of the CDK stack) for the
Transcribe piece of the AWS Builder mini challenge:

```bash
npx tsx scripts/transcribe-subtitles.ts --bucket <some-s3-bucket> [--wait]
```

For every title in `/content/titles.json` missing subtitles, it uploads the local video (if not
already an `s3://` URL), starts a `StartTranscriptionJob` with `Subtitles: { Formats: ['srt'] }`,
and — with `--wait` — polls until done, downloads the `.srt`, and patches `titles.json`. See the
file's header comment for the full behavior. Not exercised in this repo (no video files /
credentials in this environment); it's a documented, runnable script for whoever owns content
generation.

## Rough cost estimate (hackathon-scale usage)

Assuming a demo/judging period, not sustained production traffic — a handful of titles, maybe a
few hundred `/v1/ask` calls total:

| Service | Basis | Est. cost |
| --- | --- | --- |
| Lambda | ARM64, 1024MB, a few hundred invocations, <2s each | **$0** (comfortably inside the always-free tier: 1M requests + 400,000 GB-s/month) |
| API Gateway (HTTP API) | $1.00 per million requests | **~$0** at hackathon volume |
| DynamoDB | On-demand, sessions table, tiny items, TTL-expired within 12h | **~$0** (a few cents at most; on-demand write is ~$1.25/million WRUs) |
| S3 | A few subtitle files (KBs) + requests | **~$0** (pennies; storage is fractions of a GB) |
| Bedrock (Claude Haiku, Converse) | Short prompts (a few KB transcript window) + short answers, per the pricing at deploy time | **~$0.01–0.05 per demo question** — the main variable cost. A live judged demo of ~20-30 questions is well under $2. |
| Polly (Neural) | $16/1M characters (neural tier); answers are ≤3-5 sentences | **~$0.01 total** for a demo's worth of spoken answers |
| Transcribe | $0.024/minute (standard, batch) | Only if you generate subtitles for a title that doesn't have any — a 90-minute film ≈ **$2.16**, a one-time cost per title, not per request |

**Bottom line: a full hackathon demo — including judging — should cost well under $5 total**,
dominated by whatever Bedrock/Transcribe usage actually happens, not by the always-on
infrastructure (which is either free-tier or pennies at this scale). The only way this gets
expensive is leaving Bedrock traffic running unattended at high volume, which a hackathon demo
won't do.
