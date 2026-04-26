const cacheService = require('../services/cacheService');
const Token = require('../models/Token'); // Assuming a Mongoose Token model

/**
 * @description Get a single token by its ID, using cache-aside pattern.
 */
const getTokenById = async (req, res) => {
    const { id } = req.params;

    // 1. Check cache first
    const cachedToken = await cacheService.getMetadata(id);
    if (cachedToken) {
        return res.status(200).json({ success: true, data: cachedToken, source: 'cache' });
    }

    // 2. If cache miss, fetch from database
    const tokenFromDb = await Token.findById(id).lean();

    if (!tokenFromDb) {
        return res.status(404).json({ success: false, error: 'Token not found' });
    }

    // 3. Populate cache for next time
    await cacheService.setMetadata(id, tokenFromDb);

    res.status(200).json({ success: true, data: tokenFromDb, source: 'database' });
};

/**
 * @description Update a token's metadata and invalidate the cache.
 */
const updateTokenMetadata = async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;

    const updatedToken = await Token.findByIdAndUpdate(
        id,
        { name },
        { new: true }
    ).lean();

    if (!updatedToken) {
        return res.status(404).json({ success: false, error: 'Token not found' });
    }

    // 4. Invalidate cache to prevent serving stale data
    await cacheService.invalidateMetadata(id);

    res.status(200).json({ success: true, data: updatedToken });
};