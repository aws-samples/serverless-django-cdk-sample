#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag'
import { Aspects } from 'aws-cdk-lib';
import { BuildConfig, getConfig } from '../lib/get-config';
import { DjangoStack } from '../lib/django-stack';

const app = new cdk.App();

let buildConfig: BuildConfig = getConfig();
const accountEnv = { region: buildConfig.Parameters.REGION, account: buildConfig.Parameters.ACCOUNT_ID };

new DjangoStack(app, 'DjangoStack', {
  env: accountEnv
}, buildConfig);

Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))
