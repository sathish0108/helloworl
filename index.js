// Load environment variables
require("dotenv").config();

// Import express module
const express = require("express");

// Initialize the express app
const app = express();

// Example of using the secret key (optional)
const secretKey = process.env.SECRET_KEY;
console.log("Loaded SECRET_KEY:", secretKey);

// Define a simple route for the root
app.get("/hello", (req, res) => {
  res.send("Hello, World! This is your API.");
});

// Define a sample API endpoint
app.get("/hello/api/greet", (req, res) => {
  res.json({ message: "Hello from the API!", secretLoaded: !!secretKey });
});

app.get("/hello/test", (req, res) => {
  res.send("Hello, World! This is your API test1.");
});

// Start the server on port from .env
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
