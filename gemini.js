import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
// import OpenAI, { toFile } from "openai";
import { GoogleGenAI, Modality } from "@google/genai";
import dotenv from "dotenv";
import cors from "cors";
import { v2 as cloudinary } from "cloudinary";
import axios from "axios";

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_APIKEY,
  api_secret: process.env.CLOUDINARY_SECRET,
});

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

// Configure multer for file uploads
const upload = multer({ dest: "uploads/" });

// Serve the generated images from the "outputs" folder
app.use("/outputs", express.static("outputs"));

// Endpoint: POST /generateAvatar
app.post("/generateAvatar", upload.single("image"), async (req, res) => {
  console.log("Generating avatar...");
  try {
    const uploadedPath = req.file.path;
    // const fileStream = fs.createReadStream(uploadedPath);
    // const imageFile = await toFile(fileStream, null, { type: "image/png" });
    // const referImage = await toFile(fs.createReadStream("refer.png"), null, {
    //   type: "image/png",
    // });

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
Try to keep the neck like the input image. Longer in length, and the png-mask at the bottom should not be slant, it should be horizontal. Background must be transparent.`;
    const bufferResponse = await gemini(uploadedPath, "refer.png", prompt);
    const base64Image = await removeBackground(bufferResponse);

    // const imageBase64 = response.data[0].b64_json;
    const finalBuffer = Buffer.from(base64Image, "base64");

    const outputFileName = `output_${Date.now()}.png`;
    const outputPath = path.join("outputs", outputFileName);
    fs.writeFileSync(outputPath, finalBuffer);

    // Delete uploaded temp file
    fs.unlinkSync(uploadedPath);

    // Respond with URL to generated image
    const fullUrl = `${req.protocol}://${req.get(
      "host"
    )}/outputs/${outputFileName}`;
    console.log("Generated avatar URL:", fullUrl);
    res.status(200).json({ success: true, url: fullUrl, b64: base64Image });
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

async function gemini(path1, path2, promptText) {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

  const imagePath = path1;
  const imageData = fs.readFileSync(imagePath);
  const base64Image1 = imageData.toString("base64");

  const imagePath2 = path2;
  const imageData2 = fs.readFileSync(imagePath2);
  const base64Image2 = imageData2.toString("base64");

  const prompt = [
    {
      text: promptText,
    },
    {
      inlineData: {
        mimeType: "image/png",
        data: base64Image1,
      },
    },
    {
      inlineData: {
        mimeType: "image/png",
        data: base64Image2,
      },
    },
  ];

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image-preview",
    contents: prompt,
  });
  for (const part of response.candidates[0].content.parts) {
    if (part.text) {
      console.log(part.text);
    } else if (part.inlineData) {
      const imageData = part.inlineData.data;
      const buffer = Buffer.from(imageData, "base64");

      return buffer;
    }
  }
}

async function removeBackground(input) {
  let publicId; // track for cleanup
  try {
    // normalize to base64 string without data URI header
    let b64;
    if (Buffer.isBuffer(input)) {
      b64 = input.toString("base64");
    } else {
      b64 = input.replace(/^data:image\/\w+;base64,/, "");
    }

    // upload with background removal transformation
    const result = await cloudinary.uploader.upload(
      `data:image/png;base64,${b64}`,
      {
        transformation: [{ effect: "background_removal" }],
      }
    );

    publicId = result.public_id; // save public_id for deletion

    // fetch processed image from Cloudinary
    const response = await axios.get(result.secure_url, {
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(response.data);

    return buffer.toString("base64");
  } catch (err) {
    console.error("❌ Background removal failed:", err);
    throw err;
  } finally {
    // cleanup: delete uploaded image from cloudinary
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (cleanupErr) {
        console.warn("⚠️ Failed to delete temp Cloudinary image:", cleanupErr);
      }
    }
  }
}
