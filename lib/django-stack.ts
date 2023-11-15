import * as cdk from 'aws-cdk-lib';
import { StackProps, aws_ec2 } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { BuildConfig } from './get-config';
import { DjangoDB } from './constructs/django-db';
import { DjangoECS } from './constructs/django-ecs';
import { NagSuppressions } from "cdk-nag";


export class DjangoStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: StackProps, buildConfig: BuildConfig) {
        super(scope, id, props);        

        const vpc = new aws_ec2.Vpc(this, 'base-vpc', {
            ipAddresses: aws_ec2.IpAddresses.cidr("172.20.0.0/16"),
            maxAzs: 2,
        })
        vpc.addFlowLog('vpc-flow-logs')

        const djangoDB = new DjangoDB(this, 'django-db', {
            vpc: vpc
        })

        new DjangoECS(this, 'django-ecs', {
            vpc: vpc,
            dbSecurityGroup: djangoDB.dbSecurityGroup,
            dbCluster: djangoDB.dbCluster
        }, buildConfig)        

        NagSuppressions.addStackSuppressions(this, [
            {
                id: 'AwsSolutions-IAM4',
                reason: 'Simplicity for sample purposes'
            },
            {
                id: 'AwsSolutions-IAM5',
                reason: 'Simplicity for sample purposes'
            },
        ])

    }
}
