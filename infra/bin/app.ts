#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ContextCueStack } from '../lib/contextcue-stack';

const app = new cdk.App();

new ContextCueStack(app, 'ContextCueStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1'
  },
  description: 'ContextCue — spoiler-safe AI viewing companion (Fire TV / AWS Builder hackathon)'
});
