const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");
const DeploymentAudit = require("../../models/DeploymentAudit");
const {
  validateToken,
  validatePagination,
  validateSearch,
} = require("../../validators/token-validator");
const { AppError } = require("../../middleware/error-handler");

let mongoServer;

const createNext = () => jest.fn();

describe("Token Validator Middleware", () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterEach(async () => {
    await DeploymentAudit.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  describe("validateToken", () => {
    it("should validate token payloads and apply default decimals", async () => {
      const req = {
        body: {
          name: "Valid Token",
          symbol: "VTKN",
          contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          ownerPublicKey: "GDZYF2MVD4MMJIDNVTVCKRWP7F55N56CGKUCLH7SZ7KJQLGMMFMNVOVP",
        },
        user: { _id: new mongoose.Types.ObjectId() },
      };
      const next = createNext();

      await validateToken(req, {}, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.body.decimals).toBe(7);
    });

    it("should return a validation error and create an audit log when a user is present", async () => {
      const userId = new mongoose.Types.ObjectId();
      const req = {
        body: {
          name: "No",
          symbol: "bad",
        },
        user: { _id: userId },
        correlationId: "test-correlation-id",
      };
      const next = createNext();

      await validateToken(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      const error = next.mock.calls[0][0];
      expect(error.code).toBe("VALIDATION_ERROR");

      const audit = await DeploymentAudit.findOne({ userId });
      expect(audit).toBeDefined();
      expect(audit.status).toBe("FAIL");
    });

    it("should return a validation error without creating an audit log when no user is present", async () => {
      const req = {
        body: {
          name: "No",
          symbol: "bad",
        },
        correlationId: "test-correlation-id",
      };
      const next = createNext();

      await validateToken(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
      expect(await DeploymentAudit.countDocuments()).toBe(0);
    });
  });

  describe("validatePagination", () => {
    it("should coerce pagination values", () => {
      const req = { query: { page: "2", limit: "10" } };
      const next = createNext();

      validatePagination(req, {}, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.query.page).toBe(2);
      expect(req.query.limit).toBe(10);
    });

    it("should return an AppError for invalid pagination", () => {
      const req = { query: { page: "0", limit: "200" } };
      const next = createNext();

      validatePagination(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });

  describe("validateSearch", () => {
    it("should normalize empty search strings to undefined", () => {
      const req = { query: { search: "" } };
      const next = createNext();

      validateSearch(req, {}, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.query.search).toBeUndefined();
    });

    it("should return an AppError for oversized search strings", () => {
      const req = { query: { search: "a".repeat(51) } };
      const next = createNext();

      validateSearch(req, {}, next);

      expect(next).toHaveBeenCalledWith(expect.any(AppError));
    });
  });
});
