var log4js = require("log4js");
var logger = log4js.getLogger();
logger.level = "debug";


export async function log(...args: any[]) {
    logger.debug(...args)
}

export async function debug(...args: any[]) {
    logger.debug(...args)
}