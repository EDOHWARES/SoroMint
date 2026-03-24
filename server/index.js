const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const Token = require("./models/Token");
const DeploymentAudit = require("./models/DeploymentAudit");
const stellarService = require("./services/stellar-service");
const {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  AppError,
} = require("./middleware/error-handler");
const {
  logger,
  correlationIdMiddleware,
  httpLoggerMiddleware,
  logStartupInfo,
  logDatabaseConnection,
} = require("./utils/logger");
const { setupSwagger } = require("./config/swagger");
const { authenticate } = require("./middleware/auth");
const authRoutes = require("./routes/auth-routes");
const statusRoutes = require("./routes/status-routes");
const auditRoutes = require("./routes/audit-routes");
const tokenRoutes = require("./routes/token-routes");

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Logging middleware (must be early in the chain)
app.use(correlationIdMiddleware);
app.use(httpLoggerMiddleware);

// Set up API Documentation
setupSwagger(app);

// Database Connection
mongoose
  .connect(process.env.MONGO_URI || "mongodb://localhost:27017/soromint")
  .then(() => {
    logDatabaseConnection(true);
  })
  .catch((err) => {
    logDatabaseConnection(false, err);
  });

// Routes
app.use("/api", statusRoutes);
app.use("/api", auditRoutes);
app.use("/api", tokenRoutes);
app.use("/api/auth", authRoutes);

// 404 handler for undefined routes
app.use(notFoundHandler);

// Centralized error handling middleware (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  logStartupInfo(PORT, process.env.NETWORK_PASSPHRASE || "Unknown Network");
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(
    `📚 API Documentation available at http://localhost:${PORT}/api-docs`,
  );
});
