import express, { Express, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import imageRoutes from "./routes/image.routes";

// Load environment variables
dotenv.config();

const app: Express = express();
const port = process.env.PORT || 5001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  console.log(`⚡️[server]: Backend is running at http://localhost:${port}`);
});
