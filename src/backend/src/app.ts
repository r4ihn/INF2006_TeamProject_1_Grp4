// Import statements
import express, { Express, Request, Response } from "express";
import cors from "cors";

// Create app function and to return the health status
export function createApp(): Express {
    const app = express();
    app.use(express.json());
    app.use(cors());

    app.get("/health", (_req: Request, res: Response) => {
        res.status(200).json({ status: "ok" });
    });

    return app;
}