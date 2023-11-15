import * as fs from 'fs'
import * as path from "path";
const yaml = require('js-yaml');


export interface BuildConfig {
    readonly Parameters: Parameters;
}


export interface Parameters {
    readonly ACCOUNT_ID: string;
    readonly REGION: string;
    readonly PERSONAL_HOSTED_ZONE_ID: string;
    readonly PERSONAL_HOSTED_ZONE_DOMAIN: string;    
}

function ensureString(object: { [name: string]: any }, propName: string): string {
    if (!object[propName] || object[propName].trim().length === 0)
        throw new Error(propName + " does not exist or is empty");

    return object[propName];
}

function ensureBoolean(object: { [name: string]: any }, propName: string): boolean {
    if (!(typeof object[propName] === "boolean"))
        throw new Error(propName + " does not exist or is non boolean");

    return object[propName];
}

export function getConfig() {
    let unparsedEnv = yaml.safeLoad(fs.readFileSync(path.resolve("./config/config.yaml"), "utf8"));

    let buildConfig: BuildConfig = {
        Parameters: {
            ACCOUNT_ID: ensureString(unparsedEnv['Parameters'], 'ACCOUNT_ID'),
            REGION: ensureString(unparsedEnv['Parameters'], 'REGION'),
            PERSONAL_HOSTED_ZONE_ID: ensureString(unparsedEnv['Parameters'], 'PERSONAL_HOSTED_ZONE_ID'),
            PERSONAL_HOSTED_ZONE_DOMAIN: ensureString(unparsedEnv['Parameters'], 'PERSONAL_HOSTED_ZONE_DOMAIN'),
        }
    };

    return buildConfig;
}