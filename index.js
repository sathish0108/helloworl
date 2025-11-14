// Import express module
const express = require("express");

// Initialize the express app
const app = express();

// Define a simple route for the root
app.get("/hello", (req, res) => {
  res.send("Hello, World! This is your API.");
});

// Define a sample API endpoint
app.get("/hello/api/greet", (req, res) => {
  res.json({ message: "Hello from the API!" });
});

// Start the server on port 3000
const port = 8002;
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
