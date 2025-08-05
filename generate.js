import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI, { toFile } from "openai";
import dotenv from "dotenv";
import cors from "cors";
dotenv.config();

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

// Set up OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configure multer for file uploads
const upload = multer({ dest: "uploads/" });

// Serve the generated images from the "outputs" folder
app.use("/outputs", express.static("outputs"));

// Endpoint: POST /generateAvatar
app.post("/generateAvatar", upload.single("image"), async (req, res) => {
  console.log("Generating avatar...");
  try {
    const uploadedPath = req.file.path;
    const fileStream = fs.createReadStream(uploadedPath);
    const imageFile = await toFile(fileStream, null, { type: "image/png" });
    const referImage = await toFile(fs.createReadStream("refer.png"), null, {
      type: "image/png",
    });

    const prompt = `I have uploaded 2 image. one cartoon image of a head facing right ('input'), another image is of a real person('reference').
I want you to modify a few properties of the 'input' image according to the 'reference' image.  
{
  properties_to_modify: [
    "skin_color",
    "hair_color",
    "hair_style",
    "facial_features",
  ],
  output_image_properties: {
    aspect_ratio: "1:1",
    background: "transparent",
    type: "png",
    profile:"side profile facing right",
    appearance:"cartoonish"
  },
};
IMPORTANT:
Try to keep the neck like the input image. Longer in length, and the png-mask at the bottom should not be slant, it should be horizontal.`;
    const response = await client.images.edit({
      model: "gpt-image-1",
      image: [imageFile, referImage],
      prompt,
      background: "transparent",
      size: "1024x1024",
      quality: "high",
      input_fidelity: "high",
    });

    const imageBase64 = response.data[0].b64_json;
    const imageBuffer = Buffer.from(imageBase64, "base64");

    // Save output image
    const outputFileName = `output_${Date.now()}.png`;
    const outputPath = path.join("outputs", outputFileName);
    fs.writeFileSync(outputPath, imageBuffer);

    // Delete uploaded temp file
    fs.unlinkSync(uploadedPath);

    // Respond with URL to generated image
    const fullUrl = `${req.protocol}://${req.get(
      "host"
    )}/outputs/${outputFileName}`;
    console.log("Generated avatar URL:", fullUrl);
    res.status(200).json({ success: true, url: fullUrl,b64:imageBase64 });
  } catch (error) {
    console.error("Error generating avatar:", error.message);
    res
      .status(500)
      .json({ success: false, message: "Failed to generate avatar." });
  }
});
app.get("/ping", (req, res) => {
  res.json({ message: "pong", time: new Date().toISOString() });
});
// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
