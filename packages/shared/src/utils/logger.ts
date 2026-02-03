import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format that mimics pino-pretty output style
const customFormat = printf(({ level, message, timestamp, name, ...meta }) => {
    const nameStr = name ? `[${name}] ` : "";
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${nameStr}${message}${metaStr}`;
});

// Base logger configuration
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(
        errors({ stack: true }),
        timestamp({ format: "YYYY-MM-DD HH:mm:ss" })
    ),
    transports: [
        new winston.transports.Console({
            format: combine(
                colorize({ all: true }),
                customFormat
            ),
        }),
    ],
});

/**
 * Logger interface that matches Pino's API signature:
 * logger.info({...meta}, "message") or logger.info("message")
 */
interface PinoCompatibleLogger {
    info(message: string): void;
    info(meta: object, message: string): void;
    debug(message: string): void;
    debug(meta: object, message: string): void;
    warn(message: string): void;
    warn(meta: object, message: string): void;
    error(message: string): void;
    error(meta: object, message: string): void;
    child(meta: object): PinoCompatibleLogger;
}

/**
 * Create a Pino-compatible wrapper around Winston logger
 */
function createPinoCompatibleLogger(winstonLogger: winston.Logger): PinoCompatibleLogger {
    const createLogMethod = (level: string) => {
        return (arg1: string | object, arg2?: string): void => {
            if (typeof arg1 === "string") {
                // Called as logger.info("message")
                winstonLogger.log(level, arg1);
            } else if (typeof arg1 === "object" && typeof arg2 === "string") {
                // Called as logger.info({...meta}, "message") - Pino style
                winstonLogger.log(level, arg2, arg1);
            }
        };
    };
    return {
        info: createLogMethod("info"),
        debug: createLogMethod("debug"),
        warn: createLogMethod("warn"),
        error: createLogMethod("error"),
        child: (meta: object): PinoCompatibleLogger => {
            const childLogger = winstonLogger.child(meta);
            return createPinoCompatibleLogger(childLogger);
        },
    };
}

/**
 * Create a named logger instance (child logger with name metadata)
 */
export const createLogger = (name: string): PinoCompatibleLogger => {
    return createPinoCompatibleLogger(logger).child({ name });
};
