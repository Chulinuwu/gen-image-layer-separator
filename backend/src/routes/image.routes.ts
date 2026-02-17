import { Router } from "express";
import multer from "multer";
import path from "path";
import {
  processImage,
  generateAndSeprate,
  suggestCampaign,
  renderCampaign,
} from "../controllers/image.controller";

const router = Router();

// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ensure the directory exists
    const uploadDir = path.join(__dirname, "../../uploads");
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname),
    );
  },
});

const upload = multer({ storage: storage });

// Routes
router.post(
  "/process",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "background", maxCount: 1 },
  ]),
  processImage,
);
router.post("/generate", upload.array("images", 10), generateAndSeprate);
router.post("/add-text", upload.single("image"), suggestCampaign);
router.post(
  "/render-text",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "background", maxCount: 1 },
  ]),
  renderCampaign,
);

export default router;
