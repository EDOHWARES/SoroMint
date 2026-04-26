const AdmZip = require('adm-zip');
const path = require('path');
const fs = require('fs');
const { getEnv } = require('../config/env-config');

/**
 * @title NFT Service
 * @notice Handles extracting NFT collections from ZIP files and parsing metadata.
 */
const processNftZip = async (zipBuffer, collectionData) => {
  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  
  // Find collection.json (assuming it's in the root or somewhere in the zip)
  const metadataEntry = zipEntries.find(entry => entry.entryName.endsWith('collection.json'));
  if (!metadataEntry) {
    throw new Error('collection.json not found in ZIP');
  }

  let metadataJson;
  try {
    metadataJson = JSON.parse(metadataEntry.getData().toString('utf8'));
  } catch (err) {
    throw new Error('collection.json is not valid JSON');
  }
  
  if (!Array.isArray(metadataJson)) {
    throw new Error('collection.json must contain an array of NFT metadata objects');
  }

  const publicNftsDir = path.join(__dirname, '../public/nfts');
  if (!fs.existsSync(publicNftsDir)) {
    fs.mkdirSync(publicNftsDir, { recursive: true });
  }

  const collectionFolder = path.join(publicNftsDir, collectionData.contractId);
  if (!fs.existsSync(collectionFolder)) {
    fs.mkdirSync(collectionFolder, { recursive: true });
  }

  const nfts = [];
  const env = getEnv();
  const baseUrl = `http://localhost:${env.PORT}`;

  for (const item of metadataJson) {
    if (!item.id || !item.image) {
      throw new Error('Each metadata item must have an id and an image field');
    }

    // find image entry (could be nested inside folders)
    const imageEntry = zipEntries.find(entry => 
      entry.entryName.endsWith(item.image) || entry.entryName.endsWith('/' + item.image)
    );
    
    if (!imageEntry) {
      throw new Error(`Image ${item.image} not found in ZIP for NFT ${item.id}`);
    }

    // extract image
    const imageFileName = path.basename(item.image);
    const imagePath = path.join(collectionFolder, imageFileName);
    fs.writeFileSync(imagePath, imageEntry.getData());

    nfts.push({
      tokenId: item.id,
      name: item.name || `NFT #${item.id}`,
      uri: `${baseUrl}/nfts/${collectionData.contractId}/${imageFileName}`,
    });
  }

  return nfts;
};

module.exports = {
  processNftZip,
};
