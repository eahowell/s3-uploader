// app.js - Main application file
const express = require("express");
const fileUpload = require("express-fileupload");
const {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const port = 3000;

// Create a temporary directory if it doesn't exist
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Middleware setup
app.use(express.json()); // Parse JSON request bodies
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from 'public' directory

// Configure express-fileupload
app.use(
  fileUpload({
    createParentPath: true, // Create parent path if it doesn't exist
    useTempFiles: true, // Use temp files instead of memory
    tempFileDir: tempDir, // Specify the temp directory
  })
);

// Initialize the S3 client to use LocalStack
const s3Client = new S3Client({
  // Force region to match what we specified in the LocalStack startup
  region: process.env.AWS_REGION || "us-east-1",

  // Add credentials (any values work for LocalStack)
  // credentials: {
  //   accessKeyId: "test",
  //   secretAccessKey: "test",
  // },

  // The crucial part - endpoint to point to LocalStack instead of AWS
  // endpoint: "http://localhost:4566",

  // Important for working with LocalStack
  // forcePathStyle: true,
});

// Set the S3 bucket name (from environment variable or default)
const bucketName = process.env.S3_BUCKET_NAME || "cc-bucket-2-3";

// Helper function to clean up temporary files
function cleanupTempFile(filePath) {
  fs.unlink(filePath, (err) => {
    if (err) {
      console.error(`Error deleting temporary file ${filePath}:`, err);
    } else {
      console.log(`Temporary file ${filePath} was deleted`);
    }
  });
}

// Endpoint 1: List all objects in a bucket
app.get("/api/objects", async (req, res) => {
  try {
    // Create a command to list objects in the bucket
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
    });

    // Send the command to AWS S3
    const response = await s3Client.send(command);

    // Return the list of objects
    res.json({
      success: true,
      objects: response.Contents || [],
    });
  } catch (error) {
    console.error("Error listing objects:", error);
    res.status(500).json({
      success: false,
      message: "Failed to list objects",
      error: error.message,
    });
  }
});

// Endpoint 2: Upload an object to a bucket
app.post("/api/objects", async (req, res) => {
  // Check if a file was provided
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({
      success: false,
      message: "No file uploaded",
    });
  }

  try {
    const uploadedFile = req.files.file;
    const fileKey = uploadedFile.name;

    // Get the temp file path from express-fileupload
    const tempFilePath = uploadedFile.tempFilePath;

    // Read the file from disk
    const fileContent = fs.readFileSync(tempFilePath);

    // Create a command to put the object in the bucket
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: fileContent, // File content from disk
      ContentType: uploadedFile.mimetype, // Set the correct content type
    });

    // Send the command to AWS S3
    await s3Client.send(command);

    // Clean up the temporary file
    cleanupTempFile(tempFilePath);

    // Return success response
    res.json({
      success: true,
      message: "File uploaded successfully",
      key: fileKey,
    });
  } catch (error) {
    console.error("Error uploading file:", error);

    // Attempt to clean up any temp files if they exist
    if (req.files && req.files.file && req.files.file.tempFilePath) {
      cleanupTempFile(req.files.file.tempFilePath);
    }

    res.status(500).json({
      success: false,
      message: "Failed to upload file",
      error: error.message,
    });
  }
});

// Endpoint 3: Retrieve an object from a bucket
app.get("/api/objects/:key", async (req, res) => {
  const key = req.params.key;

  try {
    // Create a command to get the object from the bucket
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    // Send the command to AWS S3
    const response = await s3Client.send(command);

    // Create a temporary file path for the downloaded object
    const tempFilePath = path.join(
      tempDir,
      `${uuidv4()}-${path.basename(key)}`
    );

    // Create a write stream to save the object to disk
    const fileStream = fs.createWriteStream(tempFilePath);

    // Pipe the object data to the file
    await new Promise((resolve, reject) => {
      // Handle stream events
      response.Body.pipe(fileStream)
        .on("error", (err) => {
          console.error("Error writing to file stream:", err);
          reject(err);
        })
        .on("finish", () => {
          resolve();
        });
    });

    // Set appropriate headers for the response
    res.set({
      "Content-Type": response.ContentType,
      "Content-Length": response.ContentLength,
      "Content-Disposition": `attachment; filename="${path.basename(key)}"`,
    });

    // Create a read stream from the temporary file and pipe it to the response
    const readStream = fs.createReadStream(tempFilePath);

    // Pipe the file data to the response
    readStream.pipe(res);

    // Clean up the temporary file once the response is complete
    readStream.on("end", () => {
      cleanupTempFile(tempFilePath);
    });

    // Handle errors
    readStream.on("error", (err) => {
      console.error("Error reading temporary file:", err);
      cleanupTempFile(tempFilePath);
      // If headers haven't been sent yet, send an error response
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: "Error reading file",
          error: err.message,
        });
      } else {
        // Otherwise, destroy the response to end it
        res.destroy();
      }
    });
  } catch (error) {
    console.error("Error retrieving object:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve object",
      error: error.message,
    });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

// const express = require("express");
// const fileUpload = require("express-fileupload");
// const fs = require("fs");
// const path = require("path");
// const os = require("os");
// const {
//   S3Client,
//   ListObjectsV2Command,
//   PutObjectCommand,
//   GetObjectCommand,
// } = require("@aws-sdk/client-s3");
// const { v4: uuidv4 } = require("uuid");

// const app = express();
// const port = 3000;

// const s3Client = new S3Client({
//   region: "us-east-1",
//   endpoint: "http://localhost:4566",
//   forcePathStyle: true,
// });

// const listObjectsParams = {
//   Bucket: "cc-2-4-local-bucket",
// };

// const IMAGES_BUCKET = process.env.S3_BUCKET_NAME || "cc-2-4-local-bucket";

// listObjectsCmd = new ListObjectsV2Command(listObjectsParams);

// s3Client.send(listObjectsCmd);

// const tempDir = path.join(__dirname, "temp");
// if (!fs.existsSync(tempDir)) {
//   fs.mkdirSync(tempDir, { recursive: true });
// }
// app.use(
//   fileUpload({
//     createParentPath: true,
//     useTempFiles: true,
//     tempFileDir: tempDir,
//   })
// );

// // GET - List all objects in the bucket
// app.get("/images", (req, res) => {
//   try {
//     listObjectsParams = {
//       Bucket: IMAGES_BUCKET,
//     };
//     s3Client
//       .send(new ListObjectsV2Command(listObjectsParams))
//       .then((listObjectsResponse) => {
//         res.status(200).send(listObjectsResponse);
//       });
//   } catch (error) {
//     console.error("Error listing objects:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to list objects",
//       error: error.message,
//     });
//   }
// });

// // POST - Upload an object to the bucket
// app.post("/images", (req, res) => {
//   const file = req.files.image;
//   const fileName = req.files.image.name;
//   const tempPath = `${UPLOAD_TEMP_PATH}/${fileName}`;
//   file.mv(tempPath, (err) => {
//     res.status(500);
//   });
// });

// // GET - Retrieve an object from bucket
// app.get("/images/:key", async (req, res) => {
//   const key = req.params.key;

//   try {
//     const command = new GetObjectCommand({
//       Bucket: IMAGES_BUCKET,
//       Key: key,
//     });
//     const response = await s3Client.send(command);
//     const tempFilePath = path.join(
//       tempDir,
//       `${uuidv4()}-${path.basename(key)}`
//     );

//     // Create a write stream to save the object to disk
//     const fileStream = fs.createWriteStream(tempFilePath);

//     // Pipe the object data to the file
//     await new Promise((resolve, reject) => {
//       // Handle stream events
//       response.Body.pipe(fileStream)
//         .on("error", (err) => {
//           console.error("Error writing to file stream:", err);
//           reject(err);
//         })
//         .on("finish", () => {
//           resolve();
//         });
//     });

//     // Set appropriate headers for the response
//     res.set({
//       "Content-Type": response.ContentType,
//       "Content-Length": response.ContentLength,
//       "Content-Disposition": `attachment; filename="${path.basename(key)}"`,
//     });

//     // Create a read stream from the temporary file and pipe it to the response
//     const readStream = fs.createReadStream(tempFilePath);
//     readStream.pipe(res);
//     readStream.on("end", () => {
//       cleanupTempFile(tempFilePath);
//     });
//   } catch (error) {
//     console.error("Error retrieving object:", error);
//     res.status(500).json({
//       success: false,
//       message: "Failed to retrieve object",
//       error: error.message,
//     });
//   }
// });

// // Start the server
// app.listen(port, () => {
//   console.log(`Server running on http://localhost:${port}`);
// });
