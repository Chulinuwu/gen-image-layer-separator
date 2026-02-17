# API Documentation - Gen Image Layer Separator

This backend provides endpoints for generating images using Gemini 3 Pro Image Preview and separating components (layers) for editability.

**Base URL**: `http://localhost:5001/api/image`

---

## 1. Generate Background

Generates an image based on a prompt and optional reference images.

- **URL**: `/generate`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`

### Postman / Insomnia Setup

Since these APIs handle file uploads, you **cannot** use `application/json`.

1. Open the **Body** tab in Postman.
2. Select **form-data**.
3. For file fields (`images` or `image`), change the field type from `Text` to **`File`** in the dropdown.

### Request Body (Form Data)

| Field          | Type    | Required | Description                                                                                              |
| :------------- | :------ | :------- | :------------------------------------------------------------------------------------------------------- |
| `prompt`       | string  | Yes      | The text description of the image to generate.                                                           |
| `aspect_ratio` | string  | No       | Aspect ratio: `"1:1"`, `"2:3"`, `"3:2"`, `"3:4"`, `"4:3"`, `"4:5"`, `"5:4"`, `"16:9"`. Default: `"1:1"`. |
| `resolution`   | string  | No       | Resolution: `"1K"`, `"2K"`, `"4K"`. Default: `"2K"`.                                                     |
| `images`       | file(s) | No       | Reference/Input images (multimodal). Can upload multiple files.                                          |

### Example Request (cURL)

```bash
curl -X POST http://localhost:5001/api/image/generate \
  -F "prompt=An office group photo of people making funny faces" \
  -F "aspect_ratio=5:4" \
  -F "resolution=2K" \
  -F "images=@/path/to/your/image1.png" \
  -F "images=@/path/to/your/image2.png"
```

### Response

```json
{
  "success": true,
  "data": {
    "imageUrl": "/uploads/generated-123456789.png",
    "text": "Response text from AI if any",
    "prompt": "The original prompt",
    "layers": []
  }
}
```

---

## 2. Process / Separate Layers

Analyzes an existing image to identify and separate components (text, background, etc.) for editability.

- **URL**: `/process`
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`

### Request Body (Form Data)

| Field   | Type | Required | Description                             |
| :------ | :--- | :------- | :-------------------------------------- |
| `image` | file | Yes      | The image file to analyze and separate. |

### Example Request (cURL)

```bash
curl -X POST http://localhost:5001/api/image/process \
  -F "image=@/path/to/your/image.png"
```

### Response

```json
{
  "success": true,
  "data": {
    "original": "/uploads/image-123456789.png",
    "analysis": {
      "layers": [
        {
          "type": "text",
          "content": "Hello World",
          "color": "#FFFFFF",
          "bbox": [100, 200, 150, 400],
          "fontStyle": "sans-serif"
        },
        {
          "type": "background",
          "name": "Original Background"
        }
      ]
    }
  }
}
```

---

## Technical Details

- **Framework**: Express.js with TypeScript
- **AI Engine**: Google Vertex AI (Gemini 3 Pro Image Preview & Gemini 1.5 Pro)
- **Note**: If you experience 404 errors with Vertex AI (due to preview model access), add `GOOGLE_SERVICE_ACCOUNT_LOCATION=us-east4` or another supported region to `.env`.
- **File Storage**: Local `uploads/` directory
