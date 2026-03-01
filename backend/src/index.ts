import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import imageRoutes from "./routes/image.routes";
import { vertexService } from "./services/vertex.service";

// Load environment variables
dotenv.config();

const app: Express = express();
const port = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ➡️  ${req.method} ${req.url}`);
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(
      `[${new Date().toISOString()}] 🚀 ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`,
    );
  });
  next();
});

// Static files (for uploads and generated assets)
app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads"), {
    setHeaders: (res, path) => {
      res.setHeader("Content-Disposition", "attachment");
    },
  }),
);

// API Routes
app.use("/api/image", imageRoutes);

// Health check
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Vertex AI Image Layer Separator API",
    status: "online",
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`\n──────────────────────────────────────────────────`);
  console.log(`⚡️ [server]: Backend is running at http://localhost:${port}`);
  console.log(`📡 [server]: Watching for requests...`);
  console.log(`──────────────────────────────────────────────────\n`);

  // Pre-warm RMBG-2.0 model in the background
  vertexService
    .warmupRMBG2()
    .then(() => {
      console.log(`\n✨ [ML] RMBG-2.0 system is ready and idle.`);
    })
    .catch((err) => {
      console.error(`\n❌ [ML] Warmup failed:`, err);
    });
});
