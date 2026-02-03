import winston from "winston";

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Color codes for different elements
const colors = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    magenta: "\x1b[35m",
    white: "\x1b[37m",
    gray: "\x1b[90m",
};

// Format metadata value with appropriate styling
function formatValue(key: string, value: unknown): string {
    if (value === null || value === undefined) {
        return `${colors.dim}null${colors.reset}`;
    }
    if (typeof value === "number") {
        return `${colors.yellow}${value}${colors.reset}`;
    }
    if (typeof value === "boolean") {
        return value ? `${colors.green}true${colors.reset}` : `${colors.yellow}false${colors.reset}`;
    }
    if (typeof value === "string") {
        // Truncate long strings (like signatures)
        if (value.length > 24 && (key === "signature" || key === "orderId" || key === "lastSignature" || key === "checkpointSignature")) {
            return `${colors.cyan}"${value.slice(0, 12)}...${value.slice(-8)}"${colors.reset}`;
        }
        return `${colors.cyan}"${value}"${colors.reset}`;
    }
    if (typeof value === "object") {
        return `${colors.dim}${JSON.stringify(value)}${colors.reset}`;
    }
    return String(value);
}

// Format metadata object into a pretty string
function formatMeta(meta: Record<string, unknown>): string {
    const entries = Object.entries(meta);
    if (entries.length === 0) return "";
    const formatted = entries
        .map(([key, value]) => `${colors.gray}${key}${colors.reset}=${formatValue(key, value)}`)
        .join(" ");
    return ` ${formatted}`;
}

// Custom pretty format
const prettyFormat = printf(({ level, message, timestamp, name, ...meta }) => {
    const timeStr = `${colors.dim}${timestamp}${colors.reset}`;
    const nameStr = name ? `${colors.magenta}[${name}]${colors.reset} ` : "";
    const msgStr = `${colors.white}${message}${colors.reset}`;
    const metaStr = formatMeta(meta as Record<string, unknown>);
    return `${timeStr} ${level} ${nameStr}${msgStr}${metaStr}`;
});

// Base logger configuration
export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    format: combine(
        errors({ stack: true }),
        timestamp({ format: "HH:mm:ss" })
    ),
    transports: [
        new winston.transports.Console({
            format: combine(
                colorize({ level: true }),
                prettyFormat
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
