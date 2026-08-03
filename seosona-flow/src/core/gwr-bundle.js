var GWR = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/sdk/image-data.js
  var image_data_exports = {};
  __export(image_data_exports, {
    WatermarkEngine: () => WatermarkEngine,
    calculateWatermarkPosition: () => calculateWatermarkPosition,
    createWatermarkEngine: () => createWatermarkEngine,
    detectWatermarkConfig: () => detectWatermarkConfig,
    removeRepeatedWatermarkLayers: () => removeRepeatedWatermarkLayers,
    removeWatermarkFromImageData: () => removeWatermarkFromImageData,
    removeWatermarkFromImageDataSync: () => removeWatermarkFromImageDataSync
  });

  // src/core/geminiSizeCatalog.js
  var WATERMARK_CONFIG_BY_TIER = Object.freeze({
    "0.5k": Object.freeze({ logoSize: 48, marginRight: 32, marginBottom: 32 }),
    "1k": Object.freeze({ logoSize: 96, marginRight: 64, marginBottom: 64 }),
    "2k": Object.freeze({ logoSize: 96, marginRight: 64, marginBottom: 64 }),
    "4k": Object.freeze({ logoSize: 96, marginRight: 64, marginBottom: 64 }),
    "2k-new-margin": Object.freeze({
      logoSize: 96,
      marginRight: 192,
      marginBottom: 192,
      alphaVariant: "20260520"
    })
  });
  var GEMINI_3X_CURRENT_1K_WATERMARK_CONFIG = Object.freeze({
    logoSize: 48,
    marginRight: 32,
    marginBottom: 32
  });
  var GEMINI_3X_LEGACY_1K_WATERMARK_CONFIG = Object.freeze({
    logoSize: 96,
    marginRight: 64,
    marginBottom: 64
  });
  var GEMINI_3X_CURRENT_1K_LARGE_MARGIN_WATERMARK_CONFIG = Object.freeze({
    logoSize: 48,
    marginRight: 96,
    marginBottom: 96
  });
  var GEMINI_3X_V2_SMALL_WATERMARK_CONFIG = Object.freeze({
    logoSize: 36,
    marginRight: 96,
    marginBottom: 96,
    alphaVariant: "v2"
  });
  var KNOWN_FIXED_GEMINI_WATERMARK_CONFIGS_BY_SIZE = Object.freeze({
    "1408x768": Object.freeze([
      Object.freeze({ logoSize: 46, marginRight: 32, marginBottom: 32, fixedVariant: true })
    ])
  });
  function createEntries(modelFamily, resolutionTier, rows) {
    return rows.map(([aspectRatio, width, height]) => ({
      modelFamily,
      resolutionTier,
      aspectRatio,
      width,
      height
    }));
  }
  var OFFICIAL_GEMINI_IMAGE_SIZES = Object.freeze([
    ...createEntries("gemini-3.x-image", "0.5k", [
      ["1:1", 512, 512],
      ["1:4", 256, 1024],
      ["1:8", 192, 1536],
      ["2:3", 424, 632],
      ["3:2", 632, 424],
      ["3:4", 448, 600],
      ["4:1", 1024, 256],
      ["4:3", 600, 448],
      ["4:5", 464, 576],
      ["5:4", 576, 464],
      ["8:1", 1536, 192],
      ["9:16", 384, 688],
      ["16:9", 688, 384],
      ["21:9", 792, 168]
    ]),
    ...createEntries("gemini-3.x-image", "1k", [
      ["1:1", 1024, 1024],
      ["1:4", 512, 2048],
      ["1:8", 384, 3072],
      ["2:3", 848, 1264],
      ["3:2", 1264, 848],
      ["3:4", 896, 1200],
      ["4:1", 2048, 512],
      ["4:3", 1200, 896],
      ["4:5", 928, 1152],
      ["5:4", 1152, 928],
      ["8:1", 3072, 384],
      ["9:16", 768, 1376],
      ["16:9", 1376, 768],
      ["16:9", 1408, 768],
      ["21:9", 1584, 672]
    ]),
    ...createEntries("gemini-3.x-image", "2k", [
      ["1:1", 2048, 2048],
      ["1:4", 1024, 4096],
      ["1:8", 768, 6144],
      ["2:3", 1696, 2528],
      ["3:2", 2528, 1696],
      ["3:4", 1792, 2400],
      ["4:1", 4096, 1024],
      ["4:3", 2400, 1792],
      ["4:5", 1856, 2304],
      ["5:4", 2304, 1856],
      ["8:1", 6144, 768],
      ["9:16", 1536, 2752],
      ["16:9", 2752, 1536],
      ["21:9", 3168, 1344]
    ]),
    ...createEntries("gemini-3.x-image", "2k-new-margin", [
      ["16:9", 2816, 1536]
    ]),
    ...createEntries("gemini-3.x-image", "4k", [
      ["1:1", 4096, 4096],
      ["1:4", 2048, 8192],
      ["1:8", 1536, 12288],
      ["2:3", 3392, 5056],
      ["3:2", 5056, 3392],
      ["3:4", 3584, 4800],
      ["4:1", 8192, 2048],
      ["4:3", 4800, 3584],
      ["4:5", 3712, 4608],
      ["5:4", 4608, 3712],
      ["8:1", 12288, 1536],
      ["9:16", 3072, 5504],
      ["16:9", 5504, 3072],
      ["21:9", 6336, 2688]
    ]),
    ...createEntries("gemini-2.5-flash-image", "1k", [
      ["1:1", 1024, 1024],
      ["2:3", 832, 1248],
      ["3:2", 1248, 832],
      ["3:4", 864, 1184],
      ["4:3", 1184, 864],
      ["4:5", 896, 1152],
      ["5:4", 1152, 896],
      ["9:16", 768, 1344],
      ["16:9", 1344, 768],
      ["21:9", 1536, 672]
    ])
  ]);
  var OFFICIAL_GEMINI_IMAGE_SIZE_INDEX = /* @__PURE__ */ new Map();
  for (const entry of OFFICIAL_GEMINI_IMAGE_SIZES) {
    const key = `${entry.width}x${entry.height}`;
    if (!OFFICIAL_GEMINI_IMAGE_SIZE_INDEX.has(key)) {
      OFFICIAL_GEMINI_IMAGE_SIZE_INDEX.set(key, entry);
    }
  }
  function normalizeDimension(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric);
    return rounded > 0 ? rounded : null;
  }
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function getEntryConfig(entry) {
    if (entry?.modelFamily === "gemini-3.x-image" && entry.resolutionTier === "1k") {
      return GEMINI_3X_CURRENT_1K_WATERMARK_CONFIG;
    }
    return WATERMARK_CONFIG_BY_TIER[entry.resolutionTier] ?? null;
  }
  function getEntryLegacyConfigs(entry) {
    if (entry?.modelFamily === "gemini-3.x-image" && entry.resolutionTier === "1k") {
      return [GEMINI_3X_LEGACY_1K_WATERMARK_CONFIG];
    }
    return [];
  }
  function buildConfigKey(config) {
    return `${config.logoSize}:${config.marginRight}:${config.marginBottom}:${config.alphaVariant ?? "default"}`;
  }
  function createCatalogEntry(config, metadata = {}) {
    return {
      config,
      metadata: {
        family: metadata.family ?? "catalog",
        sourcePriority: metadata.sourcePriority ?? 9,
        evidenceGate: metadata.evidenceGate ?? "required",
        modelFamily: metadata.modelFamily ?? null,
        resolutionTier: metadata.resolutionTier ?? null,
        aspectRatio: metadata.aspectRatio ?? null,
        source: metadata.source ?? null
      }
    };
  }
  function createNewMarginVariantConfig(baseConfig, width, height) {
    if (!baseConfig || baseConfig.logoSize !== 96) return null;
    if (baseConfig.marginRight === 192 && baseConfig.marginBottom === 192) return null;
    const config = {
      logoSize: 96,
      marginRight: 192,
      marginBottom: 192,
      alphaVariant: "20260520"
    };
    const x = width - config.marginRight - config.logoSize;
    const y = height - config.marginBottom - config.logoSize;
    return x >= 0 && y >= 0 ? config : null;
  }
  function createUnknownSizeNewMarginVariantConfig(baseConfig, width, height) {
    if (!baseConfig || baseConfig.logoSize !== 96) return null;
    if (Math.min(width, height) < 1024) return null;
    return createNewMarginVariantConfig(baseConfig, width, height);
  }
  function createCurrentLargeMarginVariantConfig(baseConfig, width, height, { allowAnyBase = false } = {}) {
    if (!allowAnyBase && (!baseConfig || baseConfig.logoSize !== 48)) return null;
    if (baseConfig?.marginRight === 96 && baseConfig?.marginBottom === 96) return null;
    const config = { ...GEMINI_3X_CURRENT_1K_LARGE_MARGIN_WATERMARK_CONFIG };
    const x = width - config.marginRight - config.logoSize;
    const y = height - config.marginBottom - config.logoSize;
    return x >= 0 && y >= 0 ? config : null;
  }
  function createV2SmallVariantConfig(width, height) {
    const normalizedWidth = normalizeDimension(width);
    const normalizedHeight = normalizeDimension(height);
    if (!normalizedWidth || !normalizedHeight) return null;
    if (Math.max(normalizedWidth, normalizedHeight) > 2048) return null;
    const longSide = Math.max(normalizedWidth, normalizedHeight);
    const shortSide = Math.min(normalizedWidth, normalizedHeight);
    const sourceLongDim = shortSide >= 566 ? 2752 : shortSide >= 550 ? 2816 : 2848;
    const margin = Math.round(192 * (longSide / sourceLongDim));
    const config = {
      ...GEMINI_3X_V2_SMALL_WATERMARK_CONFIG,
      marginRight: margin,
      marginBottom: margin
    };
    const x = normalizedWidth - config.marginRight - config.logoSize;
    const y = normalizedHeight - config.marginBottom - config.logoSize;
    return x >= 0 && y >= 0 ? config : null;
  }
  function createProjectedConfig(baseConfig, scaleX, scaleY, { minLogoSize, maxLogoSize, roundLogoSize = Math.round }) {
    if (!baseConfig) return null;
    return {
      logoSize: clamp(
        roundLogoSize(baseConfig.logoSize * ((scaleX + scaleY) / 2)),
        minLogoSize,
        maxLogoSize
      ),
      marginRight: Math.max(8, Math.round(baseConfig.marginRight * scaleX)),
      marginBottom: Math.max(8, Math.round(baseConfig.marginBottom * scaleY)),
      ...baseConfig.alphaVariant ? { alphaVariant: baseConfig.alphaVariant } : {}
    };
  }
  function getNearOfficialProjectionConfigs(entry, baseConfig) {
    const configs = [{ config: baseConfig, family: "near-official-projected", source: `${entry.width}x${entry.height}` }];
    if (entry?.modelFamily === "gemini-3.x-image" && entry.resolutionTier === "1k") {
      configs.push({
        config: GEMINI_3X_CURRENT_1K_LARGE_MARGIN_WATERMARK_CONFIG,
        family: "near-official-current-large-margin",
        source: `${entry.width}x${entry.height}-large-margin`,
        roundLogoSize: Math.ceil
      });
    }
    return configs;
  }
  function matchOfficialGeminiImageSize(width, height) {
    const normalizedWidth = normalizeDimension(width);
    const normalizedHeight = normalizeDimension(height);
    if (!normalizedWidth || !normalizedHeight) return null;
    return OFFICIAL_GEMINI_IMAGE_SIZE_INDEX.get(`${normalizedWidth}x${normalizedHeight}`) ?? null;
  }
  function resolveOfficialGeminiWatermarkConfig(width, height) {
    const match = matchOfficialGeminiImageSize(width, height);
    if (!match) return null;
    return getEntryConfig(match);
  }
  function isOfficialOrKnownGeminiDimensions(width, height) {
    return matchOfficialGeminiImageSize(width, height) !== null;
  }
  function resolveKnownFixedGeminiWatermarkConfigs(width, height) {
    const normalizedWidth = normalizeDimension(width);
    const normalizedHeight = normalizeDimension(height);
    if (!normalizedWidth || !normalizedHeight) return [];
    const configs = KNOWN_FIXED_GEMINI_WATERMARK_CONFIGS_BY_SIZE[`${normalizedWidth}x${normalizedHeight}`];
    return Array.isArray(configs) ? configs.map((config) => ({ ...config })) : [];
  }
  function resolveKnownFixedGeminiWatermarkConfigEntries(width, height) {
    return resolveKnownFixedGeminiWatermarkConfigs(width, height).map((config) => createCatalogEntry(config, {
      family: "fixed-size-variant",
      sourcePriority: 5,
      evidenceGate: "required",
      source: "known-fixed-size"
    }));
  }
  function resolveOfficialGeminiSearchConfigs(width, height, options = {}) {
    return resolveOfficialGeminiSearchConfigEntries(width, height, options).map((entry) => entry.config);
  }
  function resolveOfficialGeminiSearchConfigEntries(width, height, {
    maxRelativeAspectRatioDelta = 0.02,
    maxScaleMismatchRatio = 0.12,
    minLogoSize = 24,
    maxLogoSize = 192,
    limit = 3
  } = {}) {
    const normalizedWidth = normalizeDimension(width);
    const normalizedHeight = normalizeDimension(height);
    if (!normalizedWidth || !normalizedHeight) return [];
    const exactOfficialConfig = resolveOfficialGeminiWatermarkConfig(
      normalizedWidth,
      normalizedHeight
    );
    if (exactOfficialConfig) {
      const match = matchOfficialGeminiImageSize(normalizedWidth, normalizedHeight);
      const entries = [
        createCatalogEntry({ ...exactOfficialConfig }, {
          family: "exact-official-current",
          sourcePriority: 0,
          evidenceGate: "standard",
          modelFamily: match?.modelFamily ?? null,
          resolutionTier: match?.resolutionTier ?? null,
          aspectRatio: match?.aspectRatio ?? null,
          source: "official-size"
        })
      ];
      if (match?.modelFamily === "gemini-3.x-image" && match.resolutionTier === "1k") {
        const currentLargeMarginVariant = createCurrentLargeMarginVariantConfig(
          exactOfficialConfig,
          normalizedWidth,
          normalizedHeight
        );
        if (currentLargeMarginVariant) {
          entries.push(createCatalogEntry(currentLargeMarginVariant, {
            family: "known-current-variant",
            sourcePriority: 1,
            evidenceGate: "required",
            modelFamily: match.modelFamily,
            resolutionTier: match.resolutionTier,
            aspectRatio: match.aspectRatio,
            source: "202606-large-margin"
          }));
        }
        const v2SmallVariant = createV2SmallVariantConfig(
          normalizedWidth,
          normalizedHeight
        );
        if (v2SmallVariant) {
          entries.push(createCatalogEntry(v2SmallVariant, {
            family: "gemini-v2-small",
            sourcePriority: 2,
            evidenceGate: "medium",
            modelFamily: match.modelFamily,
            resolutionTier: match.resolutionTier,
            aspectRatio: match.aspectRatio,
            source: "allenk-v2-small"
          }));
        }
      }
      for (const legacyConfig of getEntryLegacyConfigs(match)) {
        entries.push(createCatalogEntry({ ...legacyConfig }, {
          family: "exact-official-legacy",
          sourcePriority: 3,
          evidenceGate: "required",
          modelFamily: match?.modelFamily ?? null,
          resolutionTier: match?.resolutionTier ?? null,
          aspectRatio: match?.aspectRatio ?? null,
          source: "legacy-96px"
        }));
      }
      if (!(match?.modelFamily === "gemini-3.x-image" && match.resolutionTier === "1k")) {
        const newMarginVariant = createNewMarginVariantConfig(
          exactOfficialConfig,
          normalizedWidth,
          normalizedHeight
        );
        if (newMarginVariant) {
          entries.push(createCatalogEntry(newMarginVariant, {
            family: "confirmed-exception",
            sourcePriority: 3,
            evidenceGate: "required",
            modelFamily: match?.modelFamily ?? null,
            resolutionTier: match?.resolutionTier ?? null,
            aspectRatio: match?.aspectRatio ?? null,
            source: "20260520-2816x1536"
          }));
        }
      }
      return entries;
    }
    const targetAspectRatio = normalizedWidth / normalizedHeight;
    const candidates = OFFICIAL_GEMINI_IMAGE_SIZES.flatMap((entry) => {
      const baseConfig = getEntryConfig(entry);
      if (!baseConfig) return [];
      const scaleX = normalizedWidth / entry.width;
      const scaleY = normalizedHeight / entry.height;
      const scale = (scaleX + scaleY) / 2;
      const entryAspectRatio = entry.width / entry.height;
      const relativeAspectRatioDelta = Math.abs(targetAspectRatio - entryAspectRatio) / entryAspectRatio;
      const scaleMismatchRatio = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
      if (relativeAspectRatioDelta > maxRelativeAspectRatioDelta) return [];
      if (scaleMismatchRatio > maxScaleMismatchRatio) return [];
      return getNearOfficialProjectionConfigs(entry, baseConfig).map((projection) => {
        const config = createProjectedConfig(projection.config, scaleX, scaleY, {
          minLogoSize,
          maxLogoSize,
          roundLogoSize: projection.roundLogoSize
        });
        const x = normalizedWidth - config.marginRight - config.logoSize;
        const y = normalizedHeight - config.marginBottom - config.logoSize;
        if (x < 0 || y < 0) return null;
        return {
          config,
          metadata: {
            family: projection.family,
            sourcePriority: 4,
            evidenceGate: "required",
            modelFamily: entry.modelFamily,
            resolutionTier: entry.resolutionTier,
            aspectRatio: entry.aspectRatio,
            source: projection.source
          },
          score: relativeAspectRatioDelta * 100 + scaleMismatchRatio * 20 + Math.abs(Math.log2(Math.max(scale, 1e-6)))
        };
      }).filter(Boolean);
    }).filter(Boolean).sort((a, b) => a.score - b.score);
    const deduped = [];
    const seen = /* @__PURE__ */ new Set();
    for (const candidate of candidates) {
      const key = `${candidate.config.logoSize}:${candidate.config.marginRight}:${candidate.config.marginBottom}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(createCatalogEntry(candidate.config, candidate.metadata));
      if (deduped.length >= limit) break;
    }
    return deduped;
  }
  function resolveGeminiWatermarkSearchConfigs(width, height, defaultConfig) {
    return resolveGeminiWatermarkSearchCatalogEntries(width, height, defaultConfig).map((entry) => entry.config);
  }
  function resolveGeminiWatermarkSearchCatalogEntries(width, height, defaultConfig) {
    const entries = [];
    if (defaultConfig) {
      entries.push(createCatalogEntry(defaultConfig, {
        family: "default-standard",
        sourcePriority: 0,
        evidenceGate: "standard",
        source: "default-config"
      }));
    }
    entries.push(...resolveKnownFixedGeminiWatermarkConfigEntries(width, height));
    entries.push(...resolveOfficialGeminiSearchConfigEntries(width, height));
    const currentLargeMarginVariant = createCurrentLargeMarginVariantConfig(defaultConfig, width, height);
    if (currentLargeMarginVariant) {
      entries.push(createCatalogEntry(currentLargeMarginVariant, {
        family: "known-current-variant",
        sourcePriority: 1,
        evidenceGate: "required",
        source: "default-large-margin"
      }));
    }
    if (!isOfficialOrKnownGeminiDimensions(width, height)) {
      const unknownSizeNewMarginVariant = createUnknownSizeNewMarginVariantConfig(defaultConfig, width, height);
      if (unknownSizeNewMarginVariant) {
        entries.push(createCatalogEntry(unknownSizeNewMarginVariant, {
          family: "known-new-margin-variant",
          sourcePriority: 2,
          evidenceGate: "required",
          source: "unknown-size-new-margin"
        }));
      }
      const unknownSizeCurrentLargeMarginVariant = createCurrentLargeMarginVariantConfig(defaultConfig, width, height, {
        allowAnyBase: true
      });
      if (unknownSizeCurrentLargeMarginVariant) {
        entries.push(createCatalogEntry(unknownSizeCurrentLargeMarginVariant, {
          family: "known-current-variant",
          sourcePriority: 1,
          evidenceGate: "required",
          source: "unknown-size-large-margin"
        }));
      }
    }
    const deduped = [];
    const seen = /* @__PURE__ */ new Set();
    for (const entry of entries) {
      const config = entry?.config;
      if (!config) continue;
      const key = buildConfigKey(config);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entry);
    }
    return deduped;
  }

  // src/core/adaptiveDetector.js
  var DEFAULT_THRESHOLD = 0.35;
  var EPSILON = 1e-8;
  var REFERENCE_WATERMARK_SIZE = 96;
  var MIN_COARSE_ADJUSTED_SCORE = 0.08;
  var clamp2 = (v, min, max) => Math.max(min, Math.min(max, v));
  function meanAndVariance(values) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    const mean = sum / values.length;
    let sq = 0;
    for (let i = 0; i < values.length; i++) {
      const d = values[i] - mean;
      sq += d * d;
    }
    return { mean, variance: sq / values.length };
  }
  function normalizedCrossCorrelation(a, b) {
    if (a.length !== b.length || a.length === 0) return 0;
    const statsA = meanAndVariance(a);
    const statsB = meanAndVariance(b);
    const den = Math.sqrt(statsA.variance * statsB.variance) * a.length;
    if (den < EPSILON) return 0;
    let num = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - statsA.mean) * (b[i] - statsB.mean);
    }
    return num / den;
  }
  function getRegion(data, width, x, y, size) {
    const out = new Float32Array(size * size);
    for (let row = 0; row < size; row++) {
      const srcBase = (y + row) * width + x;
      const dstBase = row * size;
      for (let col = 0; col < size; col++) {
        out[dstBase + col] = data[srcBase + col];
      }
    }
    return out;
  }
  function toRegionGrayscale(imageData, region) {
    const { width, height, data } = imageData;
    const size = region.size ?? Math.min(region.width, region.height);
    if (!size || size <= 0) return new Float32Array(0);
    if (region.x < 0 || region.y < 0 || region.x + size > width || region.y + size > height) {
      return new Float32Array(0);
    }
    const out = new Float32Array(size * size);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const idx = ((region.y + row) * width + (region.x + col)) * 4;
        out[row * size + col] = (0.2126 * data[idx] + 0.7152 * data[idx + 1] + 0.0722 * data[idx + 2]) / 255;
      }
    }
    return out;
  }
  function toGrayscale(imageData) {
    const { width, height, data } = imageData;
    const out = new Float32Array(width * height);
    for (let i = 0; i < out.length; i++) {
      const j = i * 4;
      out[i] = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
    }
    return out;
  }
  function sobelMagnitude(gray, width, height) {
    const grad = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx = -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1] + gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1];
        const gy = -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] + gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1];
        grad[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return grad;
  }
  function stdDevRegion(data, width, x, y, size) {
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let row = 0; row < size; row++) {
      const base = (y + row) * width + x;
      for (let col = 0; col < size; col++) {
        const v = data[base + col];
        sum += v;
        sq += v * v;
        n++;
      }
    }
    if (n === 0) return 0;
    const mean = sum / n;
    const variance = Math.max(0, sq / n - mean * mean);
    return Math.sqrt(variance);
  }
  function buildTemplateGradient(alphaMap, size) {
    return sobelMagnitude(alphaMap, size, size);
  }
  function scoreCandidate({ gray, grad, width, height }, alphaMap, templateGrad, candidate) {
    const { x, y, size } = candidate;
    if (x < 0 || y < 0 || x + size > width || y + size > height) {
      return null;
    }
    const grayRegion = getRegion(gray, width, x, y, size);
    const gradRegion = getRegion(grad, width, x, y, size);
    const spatial = normalizedCrossCorrelation(grayRegion, alphaMap);
    const gradient = normalizedCrossCorrelation(gradRegion, templateGrad);
    let varianceScore = 0;
    if (y > 8) {
      const refY = Math.max(0, y - size);
      const refH = Math.min(size, y - refY);
      if (refH > 8) {
        const wmStd = stdDevRegion(gray, width, x, y, size);
        const refStd = stdDevRegion(gray, width, x, refY, refH);
        if (refStd > EPSILON) {
          varianceScore = clamp2(1 - wmStd / refStd, 0, 1);
        }
      }
    }
    const confidence = Math.max(0, spatial) * 0.5 + Math.max(0, gradient) * 0.3 + varianceScore * 0.2;
    return {
      confidence: clamp2(confidence, 0, 1),
      spatialScore: spatial,
      gradientScore: gradient,
      varianceScore
    };
  }
  function createScaleList(minSize, maxSize) {
    const set = /* @__PURE__ */ new Set();
    for (let s = minSize; s <= maxSize; s += 8) set.add(s);
    if (48 >= minSize && 48 <= maxSize) set.add(48);
    if (96 >= minSize && 96 <= maxSize) set.add(96);
    return [...set].sort((a, b) => a - b);
  }
  function computeSizeAdjustedConfidence(confidence, size, referenceSize = REFERENCE_WATERMARK_SIZE) {
    if (!Number.isFinite(confidence) || !Number.isFinite(size) || !Number.isFinite(referenceSize) || size <= 0 || referenceSize <= 0) {
      return 0;
    }
    const sizeWeight = Math.min(1, Math.cbrt(size / referenceSize));
    return confidence * sizeWeight;
  }
  function buildSeedConfigs(width, height, defaultConfig) {
    return resolveGeminiWatermarkSearchConfigs(width, height, defaultConfig);
  }
  function getTemplate(cache, alpha96, size) {
    if (cache.has(size)) return cache.get(size);
    const alpha = size === 96 ? alpha96 : interpolateAlphaMap(alpha96, 96, size);
    const grad = buildTemplateGradient(alpha, size);
    const tpl = { alpha, grad };
    cache.set(size, tpl);
    return tpl;
  }
  function warpAlphaMap(alphaMap, size, { dx = 0, dy = 0, scale = 1 } = {}) {
    if (size <= 0) return new Float32Array(0);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(scale) || scale <= 0) {
      return new Float32Array(0);
    }
    if (dx === 0 && dy === 0 && scale === 1) return new Float32Array(alphaMap);
    const sample = (x, y) => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const ix0 = clamp2(x0, 0, size - 1);
      const iy0 = clamp2(y0, 0, size - 1);
      const ix1 = clamp2(x0 + 1, 0, size - 1);
      const iy1 = clamp2(y0 + 1, 0, size - 1);
      const p00 = alphaMap[iy0 * size + ix0];
      const p10 = alphaMap[iy0 * size + ix1];
      const p01 = alphaMap[iy1 * size + ix0];
      const p11 = alphaMap[iy1 * size + ix1];
      const top = p00 + (p10 - p00) * fx;
      const bottom = p01 + (p11 - p01) * fx;
      return top + (bottom - top) * fy;
    };
    const out = new Float32Array(size * size);
    const c = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = (x - c) / scale + c + dx;
        const sy = (y - c) / scale + c + dy;
        out[y * size + x] = sample(sx, sy);
      }
    }
    return out;
  }
  function interpolateAlphaMap(sourceAlpha, sourceSize, targetSize) {
    if (targetSize <= 0) return new Float32Array(0);
    if (sourceSize === targetSize) return new Float32Array(sourceAlpha);
    const out = new Float32Array(targetSize * targetSize);
    const scale = (sourceSize - 1) / Math.max(1, targetSize - 1);
    for (let y = 0; y < targetSize; y++) {
      const sy = y * scale;
      const y0 = Math.floor(sy);
      const y1 = Math.min(sourceSize - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < targetSize; x++) {
        const sx = x * scale;
        const x0 = Math.floor(sx);
        const x1 = Math.min(sourceSize - 1, x0 + 1);
        const fx = sx - x0;
        const p00 = sourceAlpha[y0 * sourceSize + x0];
        const p10 = sourceAlpha[y0 * sourceSize + x1];
        const p01 = sourceAlpha[y1 * sourceSize + x0];
        const p11 = sourceAlpha[y1 * sourceSize + x1];
        const top = p00 + (p10 - p00) * fx;
        const bottom = p01 + (p11 - p01) * fx;
        out[y * targetSize + x] = top + (bottom - top) * fy;
      }
    }
    return out;
  }
  function computeRegionSpatialCorrelation({ imageData, alphaMap, region }) {
    const patch = toRegionGrayscale(imageData, region);
    if (patch.length === 0 || patch.length !== alphaMap.length) return 0;
    return normalizedCrossCorrelation(patch, alphaMap);
  }
  function computeRegionGradientCorrelation({ imageData, alphaMap, region }) {
    const patch = toRegionGrayscale(imageData, region);
    if (patch.length === 0 || patch.length !== alphaMap.length) return 0;
    const size = region.size ?? Math.min(region.width, region.height);
    if (!size || size <= 2) return 0;
    const patchGrad = sobelMagnitude(patch, size, size);
    const alphaGrad = sobelMagnitude(alphaMap, size, size);
    return normalizedCrossCorrelation(patchGrad, alphaGrad);
  }
  function shouldAttemptAdaptiveFallback({
    processedImageData,
    alphaMap,
    position,
    residualThreshold = 0.22,
    originalImageData = null,
    originalSpatialMismatchThreshold = 0
  }) {
    const residualScore = computeRegionSpatialCorrelation({
      imageData: processedImageData,
      alphaMap,
      region: {
        x: position.x,
        y: position.y,
        size: position.width ?? position.size
      }
    });
    if (residualScore >= residualThreshold) {
      return true;
    }
    if (originalImageData) {
      const originalScore = computeRegionSpatialCorrelation({
        imageData: originalImageData,
        alphaMap,
        region: {
          x: position.x,
          y: position.y,
          size: position.width ?? position.size
        }
      });
      if (originalScore <= originalSpatialMismatchThreshold) {
        return true;
      }
    }
    return false;
  }
  function detectAdaptiveWatermarkRegion({
    imageData,
    alpha96,
    defaultConfig,
    threshold = DEFAULT_THRESHOLD
  }) {
    const { width, height } = imageData;
    const gray = toGrayscale(imageData);
    const grad = sobelMagnitude(gray, width, height);
    const context = { gray, grad, width, height };
    const templateCache = /* @__PURE__ */ new Map();
    const seedConfigs = buildSeedConfigs(width, height, defaultConfig);
    const seedCandidates = seedConfigs.map((config) => {
      const size = config.logoSize;
      const candidate = {
        size,
        x: width - config.marginRight - size,
        y: height - config.marginBottom - size
      };
      if (candidate.x < 0 || candidate.y < 0 || candidate.x + size > width || candidate.y + size > height) {
        return null;
      }
      const template = getTemplate(templateCache, alpha96, size);
      const score = scoreCandidate(context, template.alpha, template.grad, candidate);
      if (!score) return null;
      return {
        ...candidate,
        ...score
      };
    }).filter(Boolean);
    const bestSeed = seedCandidates.reduce((best2, candidate) => {
      if (!best2 || candidate.confidence > best2.confidence) return candidate;
      return best2;
    }, null);
    if (bestSeed && bestSeed.confidence >= threshold + 0.08) {
      return {
        found: true,
        confidence: bestSeed.confidence,
        spatialScore: bestSeed.spatialScore,
        gradientScore: bestSeed.gradientScore,
        varianceScore: bestSeed.varianceScore,
        region: {
          x: bestSeed.x,
          y: bestSeed.y,
          size: bestSeed.size
        }
      };
    }
    const baseSize = defaultConfig.logoSize;
    const minSize = clamp2(Math.round(baseSize * 0.65), 24, 144);
    const maxSize = clamp2(
      Math.min(Math.round(baseSize * 2.8), Math.floor(Math.min(width, height) * 0.4)),
      minSize,
      192
    );
    const scaleList = createScaleList(minSize, maxSize);
    const marginRange = Math.max(32, Math.round(baseSize * 0.75));
    const minMarginRight = clamp2(defaultConfig.marginRight - marginRange, 8, width - minSize - 1);
    const maxMarginRight = clamp2(defaultConfig.marginRight + marginRange, minMarginRight, width - minSize - 1);
    const minMarginBottom = clamp2(defaultConfig.marginBottom - marginRange, 8, height - minSize - 1);
    const maxMarginBottom = clamp2(defaultConfig.marginBottom + marginRange, minMarginBottom, height - minSize - 1);
    const topK = [];
    const pushTopK = (candidate) => {
      topK.push(candidate);
      topK.sort((a, b) => b.adjustedScore - a.adjustedScore);
      if (topK.length > 5) topK.length = 5;
    };
    for (const seedCandidate of seedCandidates) {
      pushTopK({
        size: seedCandidate.size,
        x: seedCandidate.x,
        y: seedCandidate.y,
        adjustedScore: computeSizeAdjustedConfidence(seedCandidate.confidence, seedCandidate.size)
      });
    }
    for (const size of scaleList) {
      const tpl = getTemplate(templateCache, alpha96, size);
      for (let mr = minMarginRight; mr <= maxMarginRight; mr += 8) {
        const x = width - mr - size;
        if (x < 0) continue;
        for (let mb = minMarginBottom; mb <= maxMarginBottom; mb += 8) {
          const y = height - mb - size;
          if (y < 0) continue;
          const score = scoreCandidate(context, tpl.alpha, tpl.grad, { x, y, size });
          if (!score) continue;
          const adjustedScore = computeSizeAdjustedConfidence(score.confidence, size);
          if (adjustedScore < MIN_COARSE_ADJUSTED_SCORE) continue;
          pushTopK({
            size,
            x,
            y,
            adjustedScore
          });
        }
      }
    }
    let best = bestSeed ?? {
      x: width - defaultConfig.marginRight - defaultConfig.logoSize,
      y: height - defaultConfig.marginBottom - defaultConfig.logoSize,
      size: defaultConfig.logoSize,
      confidence: 0,
      spatialScore: 0,
      gradientScore: 0,
      varianceScore: 0
    };
    for (const coarse of topK) {
      const scaleLo = clamp2(coarse.size - 10, minSize, maxSize);
      const scaleHi = clamp2(coarse.size + 10, minSize, maxSize);
      for (let size = scaleLo; size <= scaleHi; size += 2) {
        const tpl = getTemplate(templateCache, alpha96, size);
        for (let x = coarse.x - 8; x <= coarse.x + 8; x += 2) {
          if (x < 0 || x + size > width) continue;
          for (let y = coarse.y - 8; y <= coarse.y + 8; y += 2) {
            if (y < 0 || y + size > height) continue;
            const score = scoreCandidate(context, tpl.alpha, tpl.grad, { x, y, size });
            if (!score) continue;
            if (score.confidence > best.confidence) {
              best = {
                x,
                y,
                size,
                ...score
              };
            }
          }
        }
      }
    }
    return {
      found: best.confidence >= threshold,
      confidence: best.confidence,
      spatialScore: best.spatialScore,
      gradientScore: best.gradientScore,
      varianceScore: best.varianceScore,
      region: {
        x: best.x,
        y: best.y,
        size: best.size
      }
    };
  }

  // src/core/embeddedAlphaMaps.js
  var EMBEDDED_ALPHA_MAP_LENGTHS = {
    "36-v2": 36 * 36,
    48: 48 * 48,
    96: 96 * 96,
    "96-20260520": 96 * 96
  };
  var EMBEDDED_ALPHA_MAP_BASE64 = {
    "36-v2": "gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8wcBAPIGAADzR0FA+4eBgPoGAADyBgAA8wcBAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADzBwEA8AAAAALGwMD2ZmJg+mZiYPrGwMD2BgIA7wcBAPIGAADzBwEA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDzBwEA8AAAAAOHg4D2lpKQ+o6KiPuHg4D0AAAAAwcBAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDuBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPNXUVD6lpKQ+paSkPtXUVD6BgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgIA78fBwPZWUlD6lpKQ+o6KiPpmYmD6xsLA9AAAAAIGAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgIA7tbQ0PqWkpD6fnp4+nZycPqempj7V1FQ+gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgAA8wcBAPIGAgDuJiIg9l5aWPqWkpD6dnJw+nZycPqOioj6bmpo+sbCwPQAAAADBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgIA7gYCAO4GAgDuBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYCAO4GAADzt7Gw+qaioPp2cnD6dnJw+nZycPp2cnD6npqY+3dxcPoGAgDuBgAA8gYCAO4GAADyBgAA8gYCAO4GAADyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAgDuBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDzBwEA8AAAAAJGQED6hoKA+oaCgPpuamj6dnJw+nZycPpuamj6hoKA+oaCgPpmYGD4AAAAAwcBAPMHAQDyBgAA8gYCAO4GAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDwAAAAA0dDQPZ2cnD6hoKA+m5qaPp2cnD6dnJw+n56ePp+enj6bmpo+o6KiPp2cnD7Z2Ng9AAAAAIGAADyBgAA8gYAAPIGAgDuBgAA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDzBwEA8wcBAPAAAAAChoKA9j46OPqempj6fnp4+nZycPp2cnD6dnJw+nZycPp+enj6dnJw+m5qaPqWkpD6Pjo4+mZiYPQAAAACBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDuBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8AAAAAJmYmD2NjIw+p6amPp2cnD6bmpo+nZycPp2cnD6dnJw+nZycPp2cnD6bmpo+nZycPp2cnD6lpKQ+i4qKPpmYmD0AAAAAgYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8wcBAPIGAADyBgIA72djYPY+Ojj6npqY+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+p6amPo+Ojj7R0NA9gYCAO4GAgDvBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8AAAAAIGAADyhoCA+nZycPqWkpD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+m5qaPp+enj6dnJw+nZycPqWkpD6dnJw+kZAQPoGAADwAAAAAgYAAPMHAQDyBgAA8gYCAO4GAADyBgAA8gYAAPMHAQDyBgAA8gYAAPAAAAACBgIA7sbCwPeHgYD6fnp4+o6KiPp2cnD6bmpo+nZycPp2cnD6dnJw+nZycPp+enj6dnJw+nZycPp2cnD6bmpo+nZycPp+enj6dnJw+nZycPp2cnD6joqI+oaCgPu3sbD6JiIg9gYCAO4GAgDuBgAA8wcBAPIGAgDyBgAA8gYAAPAAAAAAAAAAAgYCAO6moqD3V1FQ+mZiYPqempj6fnp4+m5qaPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6bmpo+nZycPp2cnD6dnJw+nZycPp2cnD6bmpo+oaCgPqmoqD6XlpY+tbQ0PvHwcD2BgAA8AAAAAAAAAACBgAA8gYAAPLGwMD3h4OA90dBQPpmYmD6npqY+o6KiPp2cnD6dnJw+nZycPpuamj6dnJw+nZycPpuamj6dnJw+nZycPpuamj6dnJw+nZycPp2cnD6dnJw+nZycPpuamj6bmpo+nZycPp2cnD6dnJw+m5qaPpuamj6lpKQ+o6KiPpWUlD7R0FA+2djYPaGgID2BgIA73dxcPpmYmD6joqI+paSkPqOioj6dnJw+m5qaPp2cnD6bmpo+nZycPp2cnD6bmpo+nZycPp2cnD6bmpo+nZycPp2cnD6bmpo+m5qaPp2cnD6bmpo+nZycPp2cnD6bmpo+nZycPp2cnD6bmpo+nZycPp+enj6bmpo+nZycPqOioj6joqI+o6KiPpmYmD7NzEw+0dBQPpmYmD6lpKQ+paSkPqWkpD6fnp4+m5qaPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6bmpo+nZycPqGgoD6lpKQ+o6KiPpmYmD7d3Fw+gYCAO6GgID3h4OA90dBQPpWUlD6lpKQ+paSkPp2cnD6bmpo+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPpuamj6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+m5qaPp2cnD6joqI+paSkPpmYmD7R0FA+4eDgPaGgID2BgAA8gYAAPAAAAAAAAAAAgYAAPPHwcD21tDQ+l5aWPqmoqD6hoKA+m5qaPp2cnD6dnJw+nZycPp2cnD6bmpo+nZycPp2cnD6dnJw+nZycPp2cnD6bmpo+nZycPp2cnD6dnJw+m5qaPp2cnD6bmpo+oaCgPqempj6ZmJg+1dRUPrGwsD2BgAA8AAAAAAAAAACBgAA8gYAAPMHAQDzBwEA8gYAAPAAAAACBgIA7iYiIPe3sbD6hoKA+o6KiPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPpuamj6dnJw+nZycPp2cnD6dnJw+nZycPpuamj6joqI+oaCgPuHgYD6pqKg9gYCAOwAAAACBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8wcBAPMHAQDzBwEA8AAAAAMHAQDyRkBA+m5qaPqempj6dnJw+nZycPp2cnD6dnJw+nZycPpuamj6dnJw+nZycPpuamj6dnJw+nZycPp2cnD6dnJw+nZycPqOioj6dnJw+nZwcPoGAADyBgIA7gYCAO4GAADyBgAA8gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgIA7wcBAPIGAgDuBgIA72djYPZGQkD6npqY+nZycPpuamj6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6bmpo+nZycPp2cnD6dnJw+p6amPpGQkD7R0NA9AAAAAIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8wcBAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDzBwEA8AAAAAKGgoD2Pjo4+p6amPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPp2cnD6dnJw+nZycPpuamj6npqY+jYyMPpmYmD0AAAAAgYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPAAAAACZmJg9kZCQPqWkpD6dnJw+nZycPp2cnD6dnJw+n56ePp2cnD6dnJw+m5qaPqWkpD6Pjo4+mZiYPQAAAADBwEA8gYAAPIGAgDuBgAA8wcBAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgIA7gYAAPMHAQDwAAAAA0dDQPZ2cnD6joqI+m5qaPp2cnD6bmpo+nZycPp2cnD6bmpo+oaCgPp2cnD7R0NA9AAAAAMHAQDyBgAA8gYAAPIGAADyBgIA7gYAAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDzBwEA8gYCAO52cHD6hoKA+n56ePp2cnD6dnJw+nZycPpuamj6hoKA+o6KiPpWUFD4AAAAAwcBAPMHAQDzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAADzBwEA8gYCAO4GAADzl5GQ+paSkPp2cnD6dnJw+nZycPpuamj6npqY+7exsPoGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPIGAADzBwEA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPAAAAACpqKg9m5qaPqWkpD6bmpo+nZycPqWkpD6XlpY+iYiIPQAAAACBgAA8gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgIA71dRUPqempj6dnJw+n56ePqOioj61tDQ+gYCAO4GAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgIA7sbCwPZuamj6joqI+o6KiPpWUlD7x8HA9AAAAAMHAQDzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPNXUVD6lpKQ+paSkPtXUVD6BgAA8wcBAPMHAQDyBgAA8gYAAPIGAADzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8AAAAAOHg4D2lpKQ+paSkPuHg4D0AAAAAwcBAPMHAQDyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADzBwEA8gYAAPIGAADzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYCAO7GwMD2ZmJg+mZiYPqGgID2BgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgAA8gYCAO4GAgDvBwEA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzZ2Fg+zcxMPoGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgIA7",
    48: "gYAAPIGAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAgYCAOwAAAADj4uI+4eDgPoGAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA7gYAAPIGAgDuBgIA7gYAAPMHAQDyBgIA7gYCAO4GAgDuBgIA7gYAAPIGAgDvBwEA8gYAAPIGAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAgYCAO4WEBD6BgAA/gYAAP4GAAD4AAAAAgYAAPAAAAACBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8wcBAPIGAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAgYCAO4GAADyBgAA8gYCAOwAAAAAAAAAAgYAAPIGAgDsAAAAAAAAAAIGAgDsAAAAAgYCAO5GQkD6BgAA/gYAAP5GQkD4AAAAAgYCAOwAAAACBgIA7gYCAO4GAgDuBgAA8gYAAPAAAAACBgAA8wcBAPMHAQDyBgIA7gYCAO4GAADyBgAA8gYAAPMHAQDyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAADwAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYCAO4GAgDsAAAAAgYCAO+Hg4D6BgAA/gYAAP/Hw8D4AAAAAgYCAO4GAgDuBgIA7gYAAPIGAgDuBgAA8wcBAPIGAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAADyBgAA8gYAAPIGAgDuBgIA7gYCAO4GAADyBgAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAgYAAPoGAAD+BgAA/gYAAP4GAAD+BgAA+AAAAAAAAAACBgIA7gYAAPAAAAACBgAA8gYAAPIGAgDuBgIA7gYCAOwAAAADBwEA8wcBAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7AAAAAIGAADwAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAAAAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgIA7oaCgPoGAAD+BgAA/gYAAP4GAAD/BwMA+AAAAAAAAAACBgIA7AAAAAIGAgDuBgAA8gYAAPAAAAACBgIA7gYCAO4GAgDuBgAA8wcBAPMHAQDzBwEA8gYCAO4GAgDsAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAwcBAPIGAgDuBgIA7gYCAOwAAAAAAAAAAgYCAO4GAgDuBgIA7gYAAPIGAADwAAAAAAAAAAIGAADyJiIg9gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYCAPQAAAACBgIA7AAAAAAAAAAAAAAAAgYCAO4GAADyBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAIGAADwAAAAAgYCAO4GAADyBgIA7gYCAOwAAAAAAAAAAgYCAO8HAQDyBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDuhoKA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/o6KiPoGAgDuBgAA8AAAAAIGAgDuBgIA7gYCAO8HAQDyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPAAAAAAAAAAAgYCAO4GAADyBgIA7gYAAPIGAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAgDuBgAA8gYCAO4GAADyBgAA8gYCAO4mIiD2BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD6BgAA8gYCAO4GAADwAAAAAgYCAO4GAADyBgIA7wcBAPIGAADyBgAA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgIA7gYCAO4GAADyBgAA8gYCAOwAAAAAAAAAAgYCAO4GAgDuBgIA7AAAAAIGAADyBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAACBgIA7gYCAO+Hg4D6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP8HAwD6BgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDvBwEA8wcBAPMHAQDyBgAA8wcBAPIGAADyBgIA7gYCAO4GAADyBgAA8gYAAPIGAgDsAAAAAAAAAAIGAgDuBgAA8AAAAAIGAgDuBgIA7AAAAAAAAAAAAAAAAgYAAPIGAgDuBgIA7gYAAPAAAAACBgIA7gYCAPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/h4GA+AAAAAAAAAACBgAA8gYAAPMHAQDyBgIA7gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7AAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAO8HAQDwAAAAAgYCAO4GAADwAAAAAgYAAPAAAAACBgAA8gYCAOwAAAACBgIA9gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/x8PA+wcDAPYGAgDuBgAA8wcBAPIGAADyBgAA8gYAAPIGAADwAAAAAgYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8gYAAPIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAMHAQDyBgAA8gYCAO4GAgD3h4OA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/4eDgPoGAAD2BgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAgDuBgAA8gYCAOwAAAACBgIA7AAAAAAAAAACBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAACBgIA7gYCAO4GAgDuBgIA7gYCAO9PS0j6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP8HAwD6BgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAgDuBgAA8gYCAO4GAgDuBgIA7AAAAAAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAgYAAPIGAgDuBgIA7o6KiPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+hoKA+gYCAOwAAAACBgIA7gYCAO4GAgDvBwEA8gYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8gYAAPIGAgDuBgIA7AAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAgYCAO4GAgDuhoKA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/oaCgPgAAAACBgIA7gYCAO4GAgDvBwEA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7AAAAAIGAADwAAAAAgYCAO4GAgDsAAAAAAAAAAIGAgDsAAAAAAAAAAAAAAACBgIA7gYAAPcHAwD6BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP9HQ0D6BgIA9gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7wcBAPIGAgDzBwEA8gYAAPAAAAACBgIA7gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgIA7AAAAAAAAAADBwMA94eDgPoGAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/h4OA+iYiIPYGAgDyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAgDuBgAA8gYAAPIGAgDuBgIA7gYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAIGAgDsAAAAAAAAAAOHgYD7x8PA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4WEhD6BgIA7gYCAO4GAADzBwEA8gYAAPMHAQDzBwEA8gYCAO4GAgDsAAAAAgYAAPIGAgDsAAAAAgYCAOwAAAAAAAAAAgYAAPIGAgDuBgAA+wcDAPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/h4OA+gYCAPYGAADzBwEA8gYAAPIGAADyBgAA8gYAAPIGAgDuBgIA7AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYCAPaOioj6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP6GgoD6BgIA9gYAAPIGAgDuBgAA8gYAAPIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAO4WEBD7BwMA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/oaCgPoGAAD6BgIA7gYAAPIGAgDuBgIA7AAAAAIGAAD6RkJA+8fDwPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/h4OA+kZCQPoGAAD6BgIA84eDgPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/j4uI+4eDgPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/h4OA+gYCAO4GAAD6RkJA+4eDgPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/x8PA+kZCQPoGAAD6BgIA7gYCAO8HAQDwAAAAAgYCAO4GAAD6hoKA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/wcDAPoGAAD6BgAA8gYAAPIGAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAAAAAACBgAA8gYCAPaOioj6BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP6Oioj6JiIg9gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAADyBgIA7gYCAOwAAAAAAAAAAgYCAO4GAADyBgIA94eDgPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/BwMA+gYAAPoGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgD6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/8/LyPuXkZD6BgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7AAAAAAAAAAAAAAAAgYAAPAAAAACBgIA94+LiPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD/h4OA+wcDAPYGAgDuBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYCAPdHQ0D6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP8HAwD6BgAA9gYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAADyBgIA7gYCAO4GAgDsAAAAAAAAAAAAAAAAAAAAAgYCAO4GAgDuhoKA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/oaCgPsHAQDzBwEA8gYAAPIGAgDuBgAA8gYAAPIGAgDuBgIA7wcBAPMHAQDyBgAA8gYAAPIGAgDsAAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAACBgIA7gYCAO4GAADyBgIA7oaCgPoGAAD+BgAA/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+hoKA+gYCAO4GAgDyBgIA8gYAAPIGAADyBgAA8gYAAPIGAgDuBgIA7wcBAPMHAQDyBgIA7gYAAPIGAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgAA8wcBAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYCAO8PCwj6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP9HQ0D6BgAA8gYAAPMHAQDzBwEA8gYCAOwAAAACBgIA7gYAAPIGAADyBgAA8wcBAPMHAQDyBgIA7gYCAO8HAQDzBwEA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAPMHAQDyBgAA8wcBAPIGAADzBwEA8gYCAO4GAgDuBgIA7gYCAO6GgID3j4uI+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/4eDgPoGAgD2BgAA8wcBAPMHAQDzBwEA8gYCAO4GAgDuBgIA7gYAAPIGAADyBgAA8gYCAPMHAQDwAAAAAgYCAO8HAQDzBwEA8gYAAPIGAADyBgAA8gYCAO4GAADyBgAA8AAAAAAAAAACBgAA8wcBAPIGAADzBwEA8gYAAPIGAADwAAAAAgYCAO4GAADzJyMg98fDwPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYCAPQAAAACBgAA8gYAAPAAAAAAAAAAAgYCAO4GAgDuBgAA8wcBAPIGAADyBgIA7AAAAAAAAAACBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgIA7gYCAO4GAADyBgAA84eBgPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgIA+gYCAO4GAgDvBwEA8gYAAPIGAgDsAAAAAgYCAO4GAgDvBwEA8wcBAPIGAgDuBgAA8gYCAOwAAAAAAAAAAAAAAAIGAgDuBgIA7gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7AAAAAIGAgDuBgAA8gYAAPIGAADyBgAA8AAAAAMHAwD6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP+Hg4D6BgIA7gYCAO4GAgDuBgAA8gYAAPAAAAACBgAA8gYCAO4GAgDuBgAA8gYCAO4GAgDsAAAAAgYCAOwAAAAAAAAAAgYCAO4GAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPMHAQDyBgAA8gYCAO4GAAD6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAgD2BgIA7gYCAOwAAAACBgAA8gYAAPIGAgDuBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPAAAAAAAAAAAgYCAOwAAAACBgAA8gYAAPIGAADyBgIA7gYCAOwAAAAChoKA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/oaCgPoGAgDuBgIA7gYCAO4GAgDuBgAA8wcBAPAAAAACBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPAAAAACBgIA7gYCAO4GAADyBgAA8gYAAPIGAgDuBgIA7AAAAAIGAgDuBgIA9gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYCAPYGAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAw8LCPoKBAT+CgQE/gYAAP4GAAD+hoKA+gYCAO4GAADyBgAA8gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYAAPIGAADyBgIA7AAAAAIGAgDuBgIA7gYAAPMHAQDyBgIA7gYAAPoKBAT+BgAA/gYAAP4GAAD+BgAA+gYCAO4GAADyBgAA8AAAAAIGAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAgDuBgIA7gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgAA8gYAAPAAAAAAAAAAAgYAAPIGAADyBgIA7gYCAO/Py8j6BgAA/gYAAP+Hg4D6BgIA7gYCAO4GAADzBwEA8gYCAO4GAgDuBgAA8gYAAPAAAAAAAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAgDsAAAAAgYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgIA7gYCAO5OSkj6BgAA/gYAAP5OSkj6BgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgAA8gYCAO4GAADyBgIA7AAAAAIGAgDvBwEA8wcBAPIGAgDsAAAAAgYCAO4GAgDuBgAA8gYAAPIGAAD6BgAA/gYAAP4WEBD6BgIA7gYCAO4GAADyBgAA8gYAAPIGAADwAAAAAgYCAOwAAAACBgIA7gYAAPIGAADyBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA7gYCAOwAAAADBwEA8gYAAPIGAgDvh4OA+4eDgPoGAgDuBgIA7gYCAO4GAADyBgAA8gYAAPIGAADyBgIA7AAAAAIGAgDsAAAAAgYAAPIGAADyBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7",
    96: "gYCAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAgDwAAAAAwcBAPMHAQDyBgIA8wcBAPIGAADyhoKA8gYAAPIGAADyBgAA8AAAAAIGAADyBgIA7gYCAO4GAgDuBgIA7wcBAPIGAADzBwEA8gYCAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPIGAADwAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPOXkZD7z8vI+4+LiPu3sbD6BgIA7wcBAPAAAAACBgAA8gYCAO4GAADyBgIA8gYCAPIGAADyBgIA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8gYAAPIGAgDyBgIA8gYCAPIGAADzBwEA8gYCAO8HAQDyBgAA8gYAAPIGAgDuBgAA8wcBAPMHAQDyBgAA8wcBAPMHAQDyBgIA8wcBAPMHAQDyBgIA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgIA8oaCgPIGAgDyBgIA8wcBAPIGAgDyBgAA8wcBAPIGAgDvBwEA8wcBAPIGAgDyBgAA8gYAAPMHAQDzBwEA8gYCAO4GAADyBgIA8wcBAPIGAADyBgAA8gYCAO4GAgDsAAAAAgYCAOwAAAAAAAAAAgYAAPIGAADzBwEA8wcBAPIGAgDvBwEA8wcBAPIGAADzBwEA8oaCgPMHAQDzBwEA8gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAAAAAACBgAA8gYCAPYGAAD+BgAA/goEBP4KBAT+RkBA9gYAAPAAAAACBgIA7gYAAPIGAADyBgAA8wcBAPMHAQDyBgAA8gYAAPIGAADzBwEA8gYCAPMHAQDzBwEA8gYCAO4GAgDuBgAA8gYAAPIGAADyBgIA7gYAAPAAAAACBgAA8AAAAAIGAgDuBgIA7gYCAPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYAAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcDAPKGgoDyBgIA8oaCgPIGAgDyhoKA8gYCAOwAAAACBgAA8gYCAO4GAADyBgIA8wcBAPIGAADwAAAAAgYCAO4GAgDvBwEA8gYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAgYCAO4GAADyBgAA8gYAAPMHAQDzBwEA8gYCAPMHAQDzBwEA8AAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAgYCAO4GAADyBgAA8paQkPoGAAD+BgAA/goEBP4GAAD/FxEQ+AAAAAAAAAACBgIA7gYAAPIGAgDsAAAAAAAAAAIGAgDuBgIA7gYAAPKGgoDyBgIA8wcBAPIGAgDyBgIA8gYAAPAAAAACBgIA7gYAAPIGAADzBwEA8gYCAPIGAgDyBgAA8wcBAPKGgoDzBwEA8gYAAPIGAADyBgIA8gYCAPMHAQDzBwEA8wcBAPIGAgDyBgIA8gYCAPMHAQDyBgAA8gYCAPMHAQDyBgIA8gYCAPMHAQDzBwEA8AAAAAIGAgDuBgIA7gYAAPIGAADyhoKA8gYAAPMHAQDwAAAAAgYCAO4GAADyBgAA8AAAAAAAAAAAAAAAAgYAAPIGAADyBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDsAAAAAgYCAO4GAADyBgIA7gYCAOwAAAACBgIA7gYCAPMHAQDyBgAA8gYCAPIGAgDuBgAA8AAAAAIGAgDsAAAAAAAAAAAAAAACBgIA7gYAAPIGAADzBwEA8paSkPoGAAD+BgAA/goEBP4KBAT+hoKA+gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAAAAAAIGAgDuBgAA8gYCAPIGAgDzBwEA8gYAAPMHAQDyBgIA8gYCAPIGAADyBgAA8wcBAPIGAADzBwEA8gYCAPIGAgDyBgIA8gYCAPMHAQDyBgIA8gYAAPMHAQDyBgIA8oaCgPIGAgDyBgAA8gYCAO8HAQDzBwEA8oaCgPIGAgDzBwEA8gYCAPMHAQDyhoKA8gYCAPMHAQDzBwEA8AAAAAAAAAACBgIA7wcBAPKGgoDyBgIA8gYCAPMHAQDyBgIA7gYAAPIGAgDuBgIA7AAAAAAAAAADBwEA8gYCAO8HAQDzBwEA8AAAAAIGAADyBgIA7gYCAOwAAAACBgAA8AAAAAIGAgDsAAAAAAAAAAAAAAACBgAA8gYCAPMHAQDyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAgDuBgIA8wcBAPAAAAACBgIA7AAAAAIGAgDvBwEA85eTkPoGAAD+BgAA/gYAAP4GAAD/z8vI+gYAAPMHAQDyBgIA7gYAAPMHAQDyBgIA7gYAAPMHAQDzBwEA8gYCAPIGAgDyBgIA8wcBAPIGAgDyBgIA8wcBAPIGAADyBgIA7gYCAO8HAQDyBgIA8oaCgPIGAgDyBgIA8gYCAPIGAgDyBgIA8gYCAPMHAQDzBwEA8wcBAPIGAgDsAAAAAwcBAPIGAADzBwEA8gYCAPMHAQDzBwEA8gYAAPKGgoDyBgIA8oaCgPIGAgDzBwEA8gYCAOwAAAADBwEA8wcBAPMHAQDyBgIA8gYCAPIGAgDzBwEA8gYAAPIGAgDyBgIA8AAAAAIGAgDuBgIA7gYCAO4GAADzBwEA8gYAAPIGAgDsAAAAAgYAAPIGAADyBgIA7gYCAO4GAgDuBgIA7AAAAAIGAgDuBgAA8gYCAPIGAgDyBgIA8gYCAPIGAgDuBgIA8oaCgPIGAADyBgIA8AAAAAIGAADyBgIA8gYAAPIGAADyFhAQ+goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/iYgIPoGAADyBgAA8gYAAPMHAQDzBwEA8gYAAPIGAgDuBgAA8wcBAPIGAgDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAADyBgAA8gYCAO8HAQDzBwEA8wcBAPIGAgDyBgIA8gYCAPKGgoDzBwEA8gYAAPMHAQDyBgIA8gYCAPIGAADyBgIA7wcBAPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAgDzBwEA8gYCAPMHAQDzBwEA8gYCAO4GAADyBgIA7gYCAO4GAgDyBgIA8wcBAPMHAQDyBgIA8wcBAPAAAAACBgIA7AAAAAIGAADyBgAA8gYCAO4GAgDvBwEA8gYCAO4GAgDuBgAA8wcBAPMHAQDzBwEA8wcBAPIGAADwAAAAAgYCAO4GAADzBwEA8gYAAPIGAADyBgAA8wcBAPIGAADyBgIA7gYCAPIGAADyBgIA7gYAAPIGAgDuBgAA8gYAAPIGAADylpKQ+goEBP4GAAD+BgAA/gYAAP4KBAT+BgAA/k5KSPoGAADyBgAA8gYAAPIGAADyBgIA8wcBAPIGAADyBgIA7gYAAPIGAADzBwEA8wcBAPKGgoDzBwEA8gYCAPIGAADyBgAA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgAA8gYAAPMHAQDzBwEA8wcBAPIGAADzBwEA8gYAAPMHAQDzBwMA8oaCgPIGAgDyBgIA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8gYCAO8HAQDyBgAA8gYAAPMHAQDzBwEA8gYAAPIGAgDyBgIA8gYAAPIGAADyBgIA7gYAAPMHAQDyBgIA8gYCAO4GAgDsAAAAAgYAAPMHAQDzBwEA8wcBAPIGAgDuBgAA8wcBAPAAAAACBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDvBwEA8gYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDvj4uI+goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/8/LyPoGAADyBgAA8gYAAPIGAADyBgIA8wcBAPMHAQDyBgIA8wcBAPIGAADzBwEA8gYAAPMHAQDzBwEA8gYCAO4GAADyBgAA8gYAAPIGAADyBgIA7wcBAPIGAgDzBwEA8wcBAPIGAgDyBgAA8gYCAO8HAQDzBwEA8gYAAPMHAQDyBgIA8wcBAPIGAgDzBwEA8oaCgPKGgoDyBgIA8gYCAPIGAgDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAADyBgAA8gYAAPIGAgDuBgAA8gYCAPMHAQDyBgIA7wcBAPIGAADzBwEA8gYAAPIGAADyBgIA8gYCAO4GAgDuBgAA8wcBAPIGAgDyBgIA7gYAAPIGAADyBgAA8gYAAPAAAAACBgAA8gYAAPIGAADzBwEA8gYAAPMHAQDyBgIA8wcBAPIGAADyBgIA7gYCAO4GAgDuBgAA8gYCAO4GAgDzBwEA8wcBAPKmoKD6BgAA/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4WEBD7BwEA8gYAAPIGAgDvBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAADzBwEA8gYAAPIGAgDuBgIA7gYCAO4GAgDvBwEA8wcBAPIGAADyBgIA8gYAAPIGAgDsAAAAAgYCAO4GAgDuBgIA8wcBAPMHAQDyBgIA8wcBAPIGAADyBgIA8oaCgPIGAgDyBgAA8gYAAPIGAgDyBgIA8oaCgPIGAgDyBgIA8gYCAO8HAQDyBgIA7gYCAOwAAAACBgIA7wcBAPIGAADyBgIA7wcBAPIGAgDuBgAA8gYAAPMHAQDyBgAA8gYAAPIGAgDuBgAA8wcBAPIGAgDyBgAA8wcBAPAAAAACBgIA7AAAAAIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8wcBAPIGAgDuBgIA7AAAAAIGAgDuBgIA7gYCAO4GAADzBwEA8wcBAPLOysj6CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP8PCwj6BgAA8AAAAAIGAgDvBwEA8gYCAPIGAgDzBwEA8wcBAPMHAQDyBgAA8gYAAPMHAQDyBgAA8gYCAO4GAgDsAAAAAgYAAPIGAADzBwEA8gYAAPMHAQDyBgAA8gYCAPAAAAACBgIA7gYAAPIGAADzBwEA8gYCAPIGAgDyBgIA8gYCAPIGAgDyhoKA8gYCAPIGAADyBgIA8wcBAPMHAQDzBwEA8wcDAPIGAgDyBgIA8wcBAPIGAADyBgIA8wcBAPIGAgDuBgIA7gYCAO4GAgDvBwEA8wcBAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYAAPMHAQDzBwEA8gYAAPIGAgDyBgIA7gYCAO4GAgDuBgIA7gYCAO8HAQDyBgAA8gYCAPIGAADyBgAA8gYCAO4GAgDzBwEA8wcBAPIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAO4GAADyBgIA8iYiIPYGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+JiIg9gYCAO4GAADyBgAA8gYAAPMHAQDyBgIA7gYAAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYCAO8HAQDyBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgAA8gYAAPIGAADyBgIA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgAA8gYCAPIGAgDzBwEA8gYAAPMHAQDzBwEA8wcBAPIGAgDyBgAA8wcBAPIGAADzBwEA8wcBAPIGAADzBwEA8wcBAPIGAgDuBgIA7gYCAO4GAgDuBgAA8wcBAPIGAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPMHAQDzBwEA8gYAAPIGAADyBgIA7wcBAPIGAgDsAAAAAgYAAPIGAgDzBwEA8wcBAPIGAADyBgAA8wcBAPMHAQDyBgAA8wcBAPIGAgDuBgAA8gYCAO4GAgDuBgIA7gYCAO4GAADzBwEA8oaCgPoGAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4KBAT+BgAA/gYAAP4GAAD+FhIQ+gYAAPIGAADyBgIA7AAAAAIGAADyBgIA8wcBAPIGAgDyBgAA8gYAAPIGAADyBgAA8gYCAO4GAADyBgIA7gYCAO8HAQDyBgAA8gYAAPMHAQDwAAAAAgYAAPIGAgDuBgIA8gYCAPIGAgDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAgDyBgIA7wcBAPIGAgDvBwEA8gYAAPMHAQDzBwEA8wcBAPIGAgDyhoKA8gYCAO4GAgDuBgIA7gYAAPAAAAACBgIA7gYAAPIGAADyBgAA8AAAAAAAAAACBgIA7gYAAPMHAQDwAAAAAgYAAPIGAgDuBgAA8gYCAOwAAAADBwEA8wcBAPMHAQDwAAAAAAAAAAIGAgDvBwEA8gYAAPMHAQDzBwEA8wcBAPIGAADwAAAAAgYCAO4GAADyBgIA7gYAAPAAAAAAAAAAAgYAAPAAAAACJiIg9goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD/z8vI+gYAAPYGAgDuBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYCAOwAAAADBwEA8gYAAPIGAgDuBgAA8gYCAO4GAgDzBwEA8wcBAPIGAADyBgIA7gYAAPIGAgDuBgIA8wcBAPIGAADyBgAA8gYAAPMHAQDzBwEA8gYAAPIGAgDyBgIA8gYCAPMHAQDyBgIA8gYCAPMHAwDzBwEA8wcBAPMHAQDzBwEA8gYCAO4GAADwAAAAAgYAAPIGAgDsAAAAAgYAAPMHAQDyBgAA8gYCAOwAAAACBgAA8wcBAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYCAO4GAADyBgAA8wcBAPAAAAAAAAAAAgYCAO4GAADzBwEA8gYAAPMHAQDyBgAA8wcBAPMHAQDyBgAA8gYCAO4GAgDuBgIA7AAAAAIGAADyBgIA7gYAAPMHAQDyDgoI+gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/g4KCPoGAADyBgAA8gYAAPIGAgDuBgIA8gYCAPIGAgDyBgAA8gYCAO4GAgDuBgAA8wcBAPIGAgDuBgIA7gYAAPIGAgDzBwEA8gYCAPMHAQDyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAADzBwEA8wcBAPMHAQDzBwEA8gYAAPMHAQDzBwEA8wcBAPIGAADyBgIA8gYCAPKGgoDyBgIA8wcBAPMHAQDzBwEA8gYAAPIGAgDuBgIA7gYCAO8HAQDyBgIA8gYCAO4GAgDuBgIA7gYAAPIGAgDuBgAA8wcBAPIGAgDyBgAA8gYCAO4GAADyBgAA8gYAAPIGAgDvBwEA8gYCAPAAAAAAAAAAAgYCAO4GAADzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgIA8gYCAPJGQkD3j4uI+goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+DggI/goEBP4KBAT+BgAA/8/LyPpGQED2BgAA8oaCgPIGAgDyBgIA8wcBAPIGAADyBgIA8gYCAPIGAADzBwEA8gYAAPIGAgDyBgIA7wcBAPIGAgDyBgIA8gYCAPIGAADyBgAA8gYAAPIGAADzBwEA8wcBAPMHAQDyBgIA8gYCAPMHAQDzBwEA8gYCAPIGAgDyhoKA8gYCAPKGgoDzBwMA8gYCAPIGAADyBgIA8gYCAPMHAQDzBwEA8gYAAPMHAQDyBgAA8gYAAPMHAQDyhoKA8wcBAPIGAgDuBgAA8gYCAO4GAgDsAAAAAgYAAPIGAgDuBgAA8gYCAO8HAQDzBwEA8gYAAPIGAADzBwEA8gYAAPIGAADyBgIA7gYAAPIGAADzBwEA8gYCAO4GAADyBgIA8gYCAPMHAQDyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAADzBwEA8gYCAPKWkpD6CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/goEBP4OCAj+BgAA/goEBP4KBAT+CgQE/goEBP4WEhD7BwEA8gYCAO8HAQDyBgIA8gYAAPMHAQDzBwMA8wcBAPIGAADyBgIA7gYCAO4GAADzBwEA8gYCAPMHAQDyBgIA8gYCAPIGAADyBgAA8gYCAO8HAQDzBwEA8wcBAPIGAgDzBwEA8gYCAPMHAQDyBgIA8oaCgPMHAwDzBwEA8gYCAPIGAADyhoKA8wcBAPIGAgDzBwEA8oaCgPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8oaCgPMHAQDyBgAA8gYAAPAAAAACBgIA7gYAAPIGAgDuBgIA8gYCAPMHAQDzBwEA8gYAAPMHAQDyBgIA7gYAAPIGAgDvBwEA8wcBAPIGAADzBwEA8gYAAPIGAgDvBwEA8gYCAPKGgoDyBgAA8wcBAPIGAADzBwEA8gYCAO4GAADzBwEA8kZCQPYKBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP/Py8j6JiIg9wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgAA8gYCAO4GAgDyBgAA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgIA7gYAAPIGAADzBwEA8gYCAPIGAADyBgIA7wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDyBgIA7gYAAPMHAQDzBwEA8wcBAPKGgoDyBgIA8wcBAPIGAgDyBgAA8gYAAPIGAgDuBgIA7gYAAPIGAgDuBgIA8gYCAPIGAgDyBgIA8AAAAAIGAADzBwEA8wcBAPIGAADzBwEA8gYCAO4GAADyBgIA7gYCAO4GAADzBwEA8gYCAOwAAAACBgAA8gYCAPIGAgDzBwEA8wcBAPMHAQDyBgAA8paSkPoKBAT+BgAA/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+CgQE/gYAAP4GAAD+zsrI+gYCAPIGAADyBgAA8gYAAPMHAQDzBwEA8gYAAPIGAADyBgAA8gYCAO8HAQDyBgIA8gYCAOwAAAADBwEA8gYCAO4GAgDuBgAA8wcBAPMHAQDyBgIA8gYCAPMHAQDyBgAA8wcBAPIGAADzBwEA8gYCAPMHAQDyBgIA8oaCgPMHAQDzBwEA8wcBAPIGAADzBwEA8gYCAPMHAQDyBgIA8gYAAPMHAQDyBgIA8wcBAPIGAADyBgAA8wcBAPMHAQDyBgIA8gYAAPIGAgDuBgIA7AAAAAIGAADzBwEA8oaCgPIGAgDzBwEA8gYCAO8HAQDyBgIA7gYCAO4GAADzBwEA8gYCAPIGAADyBgIA8gYCAPMHAQDyBgAA8gYCAPIGAgDzBwEA8gYCAPKGgoDyBgIA8gYCAPMHAQDylpCQ+gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4SDAz+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/iYgIPoGAgDuBgIA7gYAAPIGAgDyBgAA8gYCAO4GAADyBgAA8AAAAAIGAADyBgAA8gYAAPIGAADyBgAA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAgDyBgIA8wcBAPIGAADyBgAA8gYAAPIGAgDzBwEA8gYAAPMHAQDyBgAA8wcBAPIGAgDyBgAA8gYAAPIGAgDyBgIA8gYAAPIGAgDzBwEA8gYAAPMHAQDyhoKA8oaCgPIGAgDyBgAA8gYCAOwAAAADBwEA8gYCAPIGAgDzBwEA8gYCAO4GAADyBgAA8gYCAO4GAADzBwEA8gYAAPIGAADyBgIA7gYCAPIGAADyBgAA8AAAAAIGAADzBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDzj4uI+goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/g4ICP4GAAD+CgQE/gYAAP4GAAD+CgQE/4+LiPpGQED3BwEA8wcBAPMHAQDyBgAA8gYAAPIGAgDuBgIA7gYCAO4GAADzBwEA8wcBAPIGAADyBgAA8wcBAPIGAADzBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAADyBgAA8wcBAPIGAADzBwEA8oaCgPMHAQDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAgDzBwEA8gYAAPIGAgDvBwEA8gYCAO4GAADyBgAA8gYAAPMHAQDyBgIA7gYAAPIGAADyBgAA8wcBAPMHAQDyBgAA8gYAAPMHAQDwAAAAAgYAAPMHAQDyBgIA8wcBAPMHAQDyBgIA8wcBAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDvBwEA8gYCAPIWEhD6BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP5OSkj6BgAA8wcBAPMHAQDyBgAA8gYCAPIGAgDuBgIA7gYCAO4GAgDvBwEA8wcBAPIGAADzBwEA8gYAAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAO4GAgDyBgIA8gYCAPIGAADyBgIA8oaCgPIGAgDyBgAA8wcBAPIGAgDuBgAA8gYAAPIGAADyBgAA8oaCgPIGAADyBgAA8gYCAPIGAgDyBgAA8wcBAPIGAADzBwEA8gYCAO4GAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgIA7gYAAPIGAgDuBgIA7gYAAPMHAQDzBwEA8gYAAPIGAgDzBwEA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgAA8AAAAAMHAQDyBgIA82djYPYKBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+DggI/goEBP4GAAD+FhAQ+wcBAPMHAQDyBgIA8gYCAPIGAADyBgIA7wcBAPMHAQDzBwEA8gYCAPMHAQDyBgIA8gYCAPMHAQDyBgAA8gYCAPMHAQDzBwEA8wcBAPMHAQDyhoKA8gYCAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgAA8gYAAPIGAgDyBgIA8gYCAPIGAgDyBgAA8wcBAPMHAQDyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDsAAAAAAAAAAAAAAAChoKA8gYCAPIGAADyBgAA8gYAAPIGAgDvBwEA8wcBAPMHAQDyBgAA8gYCAPMHAQDyBgIA7gYCAO4GAADzBwEA8oaCgPMHAQDwAAAAAgYCAO4GAADyJiIg95eTkPoKBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+DggI/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP4GAAD/j4uI+sbAwPYGAgDyhoKA8oaCgPMHAQDyBgAA8AAAAAIGAADzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAgDzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8oaCgPIGAADzBwEA8gYAAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAgDyBgAA8wcBAPIGAADyBgIA7wcBAPMHAQDwAAAAAAAAAAAAAAACBgIA7AAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAAAAAAIGAgDvBwEA8gYCAPIGAADyBgIA7gYAAPIGAADyBgAA8wcBAPIGAADzBwEA8gYCAPMHAQDzBwEA8gYAAPIGAADzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAADyjoqI+gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/s7KyPsHAQDzBwEA8gYCAPMHAQDzBwEA8gYAAPIGAADzBwEA8gYCAPIGAADyBgIA8wcBAPKGgoDyBgIA8wcBAPIGAgDyhoKA8oaCgPMHAQDyBgAA8gYCAPMHAQDzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAgDyBgIA8wcBAPIGAADyBgIA7gYAAPMHAQDyBgAA8wcBAPMHAQDwAAAAAAAAAAAAAAACBgIA7wcBAPMHAQDyBgIA7gYAAPIGAgDuBgIA7AAAAAAAAAACBgIA7gYAAPAAAAACBgAA8wcBAPIGAADyBgAA8gYCAO4GAADzBwEA8wcBAPMHAQDyBgIA7gYAAPIGAADyBgAA8wcBAPIGAgDuBgIA8wcBAPIWEhD6CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+DggI/goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP+XkZD6BgAA8gYCAO4GAgDyBgIA8gYCAO8HAQDyBgIA8gYAAPMHAQDyBgIA7gYCAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyhoKA8gYAAPMHAQDzBwEA8gYAAPMHAQDzBwEA8wcBAPIGAgDyBgAA8wcBAPIGAADwAAAAAgYAAPIGAgDuBgIA7AAAAAAAAAACBgIA7gYAAPIGAADzBwEA8gYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDsAAAAAwcBAPMHAQDyBgAA8gYAAPIGAADzBwEA8gYCAPIGAgDyBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8jYwMPoKBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4OCAj+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4OCAj+CgQE/gYAAP4GAAD+BgAA+gYCAO4GAgDyBgIA8gYAAPIGAADyBgIA8gYCAO4GAADyhoKA8wcBAPIGAgDyBgIA8gYCAO4GAgDyBgIA8gYCAPIGAgDyBgAA8oaCgPIGAgDzBwEA8gYCAPKGgoDzBwEA8gYCAPIGAgDyBgIA8wcBAPMHAQDyBgIA7wcBAPIGAgDuBgAA8gYCAO4GAADyBgIA7gYCAO4GAADyBgAA8gYAAPMHAQDyBgIA8wcBAPIGAgDsAAAAAgYCAO4GAgDuBgAA8gYCAO4GAADzBwEA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgAA8wcBAPIGAADzBwEA8gYAAPIGAgDsAAAAAwcBAPIGAADyJiIg98/LyPoKBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+CgQE/gYAAP4KBAT+BgAA/gYAAP4GAAD/x8PA+kZCQPYGAADyBgIA8gYAAPIGAADyBgAA8gYAAPIGAgDuBgAA8gYCAPIGAgDyBgAA8gYAAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAADzBwEA8gYCAO8HAQDzBwEA8gYAAPIGAgDzBwEA8wcBAPKGgoDzBwEA8gYAAPIGAADwAAAAAgYCAO4GAADyBgAA8wcBAPMHAQDyBgAA8gYAAPIGAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAADzBwEA8gYAAPIGAADyBgIA7gYAAPIGAgDvBwEA8wcBAPMHAQDwAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgD3h4OA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/4+LiPomIiD3BwEA8gYCAO4GAgDuBgIA8wcBAPIGAADyBgAA8gYCAO8HAQDyBgIA7gYAAPMHAQDyBgIA8oaCgPMHAQDzBwEA8gYCAPIGAADyBgIA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgAA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgAA8wcBAPIGAADyBgIA7gYCAO4GAADyBgIA8gYAAPMHAQDyBgAA8gYCAPIGAADyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAgDzBwEA8wcBAPIGAADwAAAAAgYCAO8HAQDyBgIA7wcBAPIGAgDsAAAAAgYCAO4GAADzBwEA8kZCQPePi4j6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/goEBP+Pi4j6BgIA9gYCAO4GAgDuhoKA8wcBAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPMHAQDyhoKA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAADyBgAA8wcBAPIGAgDyhoKA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAADyBgAA8gYAAPMHAQDyhoKA8wcBAPMHAQDzBwEA8wcBAPIGAgDuBgIA7gYCAO4GAADyBgAA8gYAAPIGAADyBgAA8wcBAPMHAQDwAAAAAgYAAPIGAADyBgAA8gYCAO4GAADyBgIA7gYAAPIGAADyxsDA94+LiPoKBAT+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+DggI/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/gYAAP4KBAT+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT/T0tI+gYAAPcHAQDyBgAA8gYCAPIGAgDsAAAAAgYCAO8HAQDyBgAA8gYAAPIGAADyBgIA8wcBAPMHAQDzBwEA8gYAAPMHAQDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAgDuBgIA7gYAAPMHAQDyBgAA8gYCAPMHAQDyBgAA8gYCAO8HAQDwAAAAAgYCAO4GAADyBgAA8gYAAPMHAQDzBwEA8wcBAPIGAADyBgAA8gYCAOwAAAACBgAA8gYCAO4GAgDuBgAA8gYAAPJmYmD3V1NQ+gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/g4ICP4GAAD+BgAA/gYAAP4GAAD+CgQE/g4ICP4KBAT+CgQE/4+LiPqGgoD2BgIA8wcDAPIGAADyBgAA8gYCAO4GAADzBwEA8gYCAPMHAQDyBgIA7gYCAPIGAgDyBgAA8gYAAPIGAADzBwEA8wcBAPIGAgDzBwEA8gYCAPIGAgDyhoKA8oaCgPMHAQDzBwEA8gYCAPIGAgDuBgAA8wcBAPMHAQDyBgAA8gYCAO8HAQDzBwEA8gYAAPIGAgDuBgIA7wcBAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYCAO8HAQDzBwEA8gYCAO8HAQDyBgIA7wcBAPIGAADzBwEA8gYAAPIGAADyBgIA7kZCQPeXk5D6CgQE/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4GAAD+CgQE/gYAAP4KBAT+CgQE/goEBP4OCAj+DggI/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4OCAj+BgAA/gYAAP+Pi4j6JiIg9gYAAPAAAAAAAAAAAwcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8gYAAPIGAADyBgAA8wcBAPIGAgDyBgIA8gYCAPMHAQDyBgIA8gYCAPIGAgDzBwEA8wcBAPIGAADzBwEA8gYCAPMHAQDwAAAAAgYAAPMHAQDzBwEA8gYCAO4GAgDuBgIA7wcBAPIGAADyBgIA7gYAAPIGAgDzBwEA8gYAAPIGAgDuBgIA7gYCAO4GAADzBwEA8gYCAPIGAADyBgAA8gYAAPIGAADyRkJA95eTkPoKBAT+CgQE/g4ICP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD/j4uI+gYCAPYGAgDuBgIA7gYCAO4GAADzBwEA8oaCgPMHAQDzBwEA8wcBAPKGgoDyBgAA8gYAAPMHAQDyBgAA8wcBAPIGAgDyBgAA8wcBAPIGAgDyBgIA8wcBAPIGAgDyBgIA8gYCAPIGAADyBgAA8gYCAPIGAgDyBgIA7AAAAAMHAQDzBwEA8gYCAO4GAgDuBgIA7gYCAPMHAQDyBgAA8wcBAPMHAQDyBgIA8wcBAPIGAgDuBgIA7AAAAAIGAADyBgAA8oaCgPMHAQDyBgIA7gYCAO4mICD7z8vI+gYAAP4KBAT+CgQE/g4ICP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/8fDwPoWEBD6BgIA7gYCAO4GAgDuBgAA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA7gYAAPIGAADzBwEA8gYCAPIGAgDyBgAA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8gYAAPIGAADzBwEA8wcDAPKGgoDwAAAAAgYAAPMHAQDzBwEA8gYCAO4GAgDuBgAA8gYAAPIGAADyBgAA8wcBAPMHAQDzBwEA8wcBAPIGAgDuBgIA7gYCAO4GAADyBgIA8wcBAPMHAQDyBgIA75eRkPoKBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgIA+gYAAPIGAADzBwEA8wcBAPIGAgDuBgIA8wcBAPIGAADyBgAA8gYCAPIGAgDyBgIA8gYCAPIGAgDyBgIA8gYCAPIGAgDyBgIA8wcBAPMHAQDyBgAA8wcBAPMHAwDyhoKA8gYCAPMHAQDwAAAAAgYCAO4GAgDyBgIA8gYAAPIGAADyBgIA7gYCAPIGAADyBgIA7wcBAPMHAQDyBgAA8wcBAPIGAADyBgIA7gYCAO4GAADyBgAA8wcBAPIGAAD2xsLA+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/goEBP4KBAT+DggI/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/o6KiPpGQkD3BwEA8wcBAPMHAQDzBwEA8gYCAPIGAgDyBgIA8gYCAPIGAgDyBgIA8gYCAPIGAgDzBwEA8wcBAPIGAgDyhoKA8wcBAPMHAQDzBwEA8gYCAPIGAgDyhoKA8gYAAPMHAQDyBgIA7gYCAO4GAgDuBgAA8gYAAPMHAQDyBgIA7gYCAO8HAQDyBgAA8gYAAPMHAQDzBwEA8wcBAPMHAQDyBgAA8AAAAAIGAADzBwEA8iYgIPuHg4D6BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP+Pi4j7R0NA9wcBAPIGAgDuBgIA8gYAAPIGAADyBgIA8wcBAPMHAQDzBwEA8gYAAPIGAADzBwEA8wcBAPIGAgDyBgIA8wcBAPMHAQDzBwEA8gYCAPIGAADyBgAA8gYCAO4GAADyBgIA7gYCAOwAAAACBgAA8wcBAPMHAQDyBgIA7gYAAPIGAgDyhoKA8gYCAPMHAQDzBwEA8gYCAPIGAADyBgAA8gYAAPIGAAD2TkpI+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+DggI/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/hYSEPsHAQDyBgAA8gYCAO4GAADyBgIA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgIA8wcBAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgIA7gYCAPKGgoDzBwEA8gYCAOwAAAADBwEA8gYAAPMHAQDyBgAA8wcBAPMHAQDyBgIA8wcBAPIGAgDzBwEA8gYCAPIGAgDzBwEA8iYgIPuPi4j6BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/gYAAP4GAAD+CgQE/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP+Xk5D6pqCg+gYAAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAgDzBwEA8wcBAPIGAgDyBgAA8gYAAPIGAADyBgAA8wcBAPIGAgDyBgAA8gYAAPIGAgDuBgAA8gYCAO8HAQDzBwEA8wcBAPMHAQDyhoKA8gYAAPIGAADyBgIA8wcBAPImIiD2zsrI+gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/g4ICP4KBAT+DggI/g4ICP4KBAT+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/paSkPomIiD3BwEA8wcBAPIGAgDzBwEA8gYCAPIGAgDzBwEA8wcBAPIGAgDzBwEA8wcBAPMHAQDyBgAA8wcBAPIGAADzBwEA8wcDAPIGAgDzBwEA8gYCAPIGAgDuBgAA8gYAAPMHAQDyBgAA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA9g4KCPvPy8j6CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/goEBP4GAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4OCAj+CgQE/goEBP4KBAT+lpKQ+kZCQPYGAADyhoKA8gYCAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8wcBAPIGAgDzBwEA8gYCAPIGAADyBgAA8gYCAPMHAQDyBgAA8wcBAPIGAADyBgAA8kZAQPYWEhD7z8vI+gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT+DggI/goEBP4KBAT+CgQE/4+LiPoWEhD6ZmJg9gYCAPKGgoDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAgDyhoKA8wcBAPMHAQDyBgIA7AAAAAIGAADzBwEA8gYAAPIGAADyBgIA7gYAAPIGAgD2FhIQ+8/LyPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/o6KiPomIiD2BgAA8gYCAPIGAADyBgIA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPIGAADyBgIA7wcBAPMHAQDyBgIA8gYAAPIGAADyFhAQ+w8LCPoGAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4SDAz+BgAA/g4ICP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+xsLA+paQkPsHAQDzBwEA8gYCAO4GAgDyBgAA8wcBAPMHAQDzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAgDuBgAA+kZCQPvPy8j6BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/g4ICP+Pi4j6joqI+kZAQPoGAgDyBgIA8wcBAPMHAQDyBgIA8wcBAPKGgID3FxEQ+o6KiPvPy8j6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4OCAj+CgQE/goEBP4KBAT+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/g4ICP4OCAj+CgQE/gYAAP4GAAD+CgQE/g4ICP4OCAj+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+DggI/goEBP+Xk5D6lpKQ+rawsPpGQkD2BgAA86ehoPoKBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/g4ICP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+DggI/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4GAAD/p6Gg+4+LiPoKBAT+CgQE/goEBP4OCAj+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4OCAj+CgQE/goEBP4GAAD+CgQE/g4ICP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+DggI/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+DggI/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT/z8vI+8/LyPoKBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4KBAT+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4KBAT/l5OQ+6ehoPoGAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/g4ICP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/g4ICP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT/t7Gw+wcBAPKmoqD2hoCA+paSkPuPi4j6BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+CgQE/goEBP/X09D6joqI+xcREPpGQED2BgAA8wcBAPIGAgDzBwEA8wcBAPIGAADyFhAQ+oaCgPuPi4j6BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/goEBP/Py8j6VlJQ+iYgIPoGAgDzBwEA8gYAAPIGAgDuBgAA8wcBAPIGAgDyBgAA8gYCAO4GAADyBgIA7gYAAPIGAADylpCQ+tbS0PoGAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+DggI/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT/DwsI+iYgIPoGAgDyhoKA8wcBAPMHAQDyBgIA7gYAAPIGAADyBgIA7gYCAPIGAgDzBwEA8wcBAPIGAADyBgAA8gYAAPIGAADyBgIA8wcBAPIGAgD2joqI+gYAAP4GAAD+BgAA/g4ICP4OCAj+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+CgQE/gYAAP4GAAD+CgQE/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4OCAj+CgQE/goEBP4KBAT+CgQE/g4ICP4OCAj+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4GAAD/z8vI+hYSEPpmYmD3BwEA8wcBAPMHAwDzBwMA8wcBAPMHAQDyBgAA8gYCAPIGAADyBgAA8gYCAPMHAQDzBwEA8wcBAPKGgoDyBgIA8gYCAPMHAQDyBgIA8gYCAPIGAADyBgAA8kZCQPYWEhD7j4uI+goEBP4KBAT+CgQE/gYAAP4KBAT+DggI/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/gYAAP4KBAT+CgQE/g4ICP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/8/LyPoOCgj6RkBA9gYAAPIGAADyBgAA8gYCAPIGAgDyhoKA8wcBAPIGAADyBgIA8wcBAPIGAgDuBgAA8gYCAPIGAADzBwEA8gYCAPKGgoDyBgIA8gYAAPMHAQDyhoKA8oaCgPIGAADzBwEA8gYAAPIGAgDyBgIA9o6KiPoKBAT+BgAA/gYAAP4KBAT+DggI/g4ICP4KBAT+CgQE/goEBP4OCAj+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP/X09D6FhIQ+oaAgPYGAgDyBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDyhoKA8gYCAPMHAQDyBgIA8wcBAPIGAADyBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgAA8gYCAPIGAgDzBwEA8oaCgPIGAgDyBgAA8gYAAPIGAADwAAAAAgYAAPImIiD2npqY+gYAAP4KBAT+DggI/goEBP4GAAD+CgQE/gYAAP4GAAD+CgQE/gYAAP4OCAj+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/s7KyPpGQkD2BgIA8wcBAPMHAQDyBgAA8gYCAPIGAgDyBgIA8wcBAPIGAgDyBgIA8gYCAPMHAQDzBwEA8gYAAPMHAQDyBgIA8wcBAPMHAQDyBgAA8wcBAPIGAADyBgAA8wcBAPIGAgDzBwEA8gYCAPIGAgDuBgIA7gYCAO4GAADwAAAAAgYCAO8HAQDzBwEA8oaAgPuHg4D6BgAA/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+DggI/goEBP4KBAT+DggI/goEBP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP+Xk5D6JiAg+gYCAPMHAQDzBwEA8wcBAPIGAgDzBwEA8wcBAPIGAADzBwEA8wcBAPIGAgDyBgIA8wcBAPMHAQDyBgIA7gYAAPMHAQDzBwEA8wcBAPIGAADzBwEA8gYAAPMHAQDzBwEA8wcBAPIGAgDzBwEA8gYCAPKGgoDyBgIA8wcBAPIGAADyBgIA7gYAAPIGAADyBgAA8AAAAAIGAADyDgoI+gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4KBAT+BgAA/gYAAP4KBAT+DggI/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/lZSUPrGwMD3BwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPKGgoDzBwEA8gYCAO8HAQDyBgIA7gYAAPIGAgDuBgAA8gYCAPIGAgDzBwEA8gYCAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAgDwAAAAAgYAAPAAAAACBgAA8gYCAO4GAgDsAAAAAwcDAPePi4j6CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4GAAD+CgQE/g4ICP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP+Pi4j6JiAg+wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPKGgoDyBgIA8wcBAPMHAQDyBgIA7gYCAO4GAgDuBgIA7wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAADyBgAA8wcBAPIGAADwAAAAAgYCAO8HAQDyBgAA8AAAAAAAAAADBwEA8gYCAO4mIiD2joqI+goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/goEBP4GAAD+DggI/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/s7KyPqGgID3BwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPKGgoDyBgIA8wcBAPMHAQDyBgAA8wcBAPIGAADyBgAA8wcBAPIGAgDyBgIA8gYCAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDyBgIA7gYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA8gYAAPIGAgDuBgIA8hYSEPoKBAT+CgQE/goEBP4KBAT+DggI/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4OCAj+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT/l5GQ+wcBAPMHAQDzBwEA8wcBAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyhoKA8wcBAPIGAADyBgIA7gYAAPIGAgDuBgAA8wcBAPMHAQDzBwEA8gYAAPMHAQDzBwEA8oaCgPIGAgDzBwEA8gYCAPIGAgDzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAgDzBwEA8gYAAPMHAQDyBgIA7wcBAPIGAgDuBgAA8gYAAPImICD7z8vI+goEBP4GAAD+CgQE/goEBP4OCAj+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/8fDwPomICD7BwEA8gYAAPMHAQDzBwEA8wcBAPIGAgDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPKGgoDyBgIA8gYCAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgAA8wcBAPMHAQDzBwEA8gYCAPIGAgDzBwEA8oaCgPIGAgDyBgIA8gYCAPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgIA7wcBAPIGAADzBwEA8gYCAPMHAQDyZmJg94+LiPoGAAD+CgQE/goEBP4GAAD+CgQE/gYAAP4KBAT+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD/j4uI+iYiIPcHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8oaCgPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8oaCgPMHAQDzBwEA8wcBAPIGAgDzBwEA8gYCAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8gYCAPMHAQDyBgIA8wcBAPMHAQDzBwEA8gYCAO8HAQDzBwEA8wcBAPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAgDyBgIA8kZCQPePi4j6CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/gYAAP4KBAT+BgAA/gYAAP4KBAT+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP+Pi4j6RkJA9gYAAPIGAADzBwEA8gYAAPIGAADzBwEA8wcBAPMHAQDyBgIA8oaCgPMHAQDyBgIA8oaCgPIGAgDyBgIA8oaCgPMHAQDzBwEA8wcBAPIGAgDyBgIA8wcBAPIGAADyBgIA8gYAAPIGAADyBgIA7gYCAPIGAgDyBgAA8wcBAPMHAQDyBgIA8wcBAPIGAgDyhoKA8oaCgPMHAQDyBgIA8wcBAPIGAADzBwEA8gYAAPIGAgDuBgIA8gYCAPIGAgDyBgIA8wcBAPIGAgDyBgIA8gYAAPMHAQDzBwEA8wcBAPJGQkD3j4uI+goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/g4ICP4GAAD+BgAA/gYAAP4KBAT+CgQE/goEBP4OCAj+CgQE/goEBP4OCAj+CgQE/g4ICP4OCAj+CgQE/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/09LSPpGQkD3BwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8gYCAPMHAQDyBgIA8gYCAPIGAgDyBgIA8gYCAPMHAQDzBwEA8gYAAPIGAgDyBgIA8gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYCAPIGAgDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAgDyBgIA8oaCgPMHAQDyBgIA8wcBAPIGAgDuBgAA8gYAAPMHAQDyBgIA8gYCAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgIA8gYCAPIGAADyhoCA909LSPoKBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4OCAj+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+CgQE/gYAAP4KBAT/j4uI+sbAwPYGAgDyBgIA7wcBAPMHAQDyBgAA8gYAAPMHAQDwAAAAAgYAAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8wcBAPIGAADzBwEA8wcBAPIGAgDyhoKA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYCAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgIA8gYAAPIGAgDyBgAA8gYAAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAgDuBgAA8wcBAPMHAQDzBwEA8mZiYPeXk5D6CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/gYAAP4GAAD+CgQE/gYAAP4KBAT+DggI/g4ICP4GAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP+Pi4j6RkJA9gYCAPIGAADzBwEA8gYCAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAADzBwEA8gYCAPMHAQDyBgAA8gYCAPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAgDyBgIA8wcBAPIGAADzBwEA8gYAAPIGAADyBgAA8wcBAPIGAgDzBwEA8wcBAPIGAADzBwEA8gYAAPMHAQDzBwEA8wcBAPIGAADyBgAA8gYAAPIGAADyBgAA8gYCAO8HAQDzBwEA8wcBAPMHAQDyBgAA8gYAAPMHAQDzBwEA8wcBAPIGAgDyBgIA7wcBAPMHAQDzBwEA8wcBAPJGQkD3j4uI+g4ICP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4KBAT+BgAA/goEBP4KBAT+DggI/goEBP4KBAT+CgQE/gYAAP4GAAD+DggI/4+LiPpGQkD2BgAA8gYAAPIGAgDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAgDyBgAA8wcBAPIGAADyhoKA8gYCAPMHAQDyBgIA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8wcBAPMHAQDyBgIA8wcBAPIGAADyBgAA8wcBAPIGAgDyBgIA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgAA8gYCAPIGAADyBgIA7gYCAO4GAgDuBgAA8gYAAPIGAADzBwEA8gYAAPMHAQDzBwEA8wcBAPMHAQDzBwEA8oaCgPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDyJiIg98/LyPoKBAT+CgQE/goEBP4KBAT+DggI/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4OCAj+CgQE/goEBP4KBAT/19PQ+kZCQPYGAgDzBwEA8wcBAPMHAQDyBgAA8wcBAPIGAADyBgIA8wcBAPIGAgDzBwEA8gYCAPMHAQDyBgIA8gYAAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAPKGgoDyhoKA8oaCgPMHAQDyBgIA8wcBAPIGAgDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAgDzBwEA8gYCAPIGAADyBgIA8wcBAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgIA7gYCAO4GAADzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAgDyhoKA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPMHAQDyBgIA7hYQEPoKBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4GAAD+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/goEBP4KBAT+DggI/goEBP4KBAT+CgQE/gYAAP4KBAT+NjAw+oaCgPKGgoDzBwEA8wcBAPMHAQDzBwEA8gYCAO4GAgDyBgAA8wcBAPKGgoDyBgAA8wcBAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAADyBgAA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgAA8gYAAPMHAQDyBgIA7gYAAPIGAgDuBgAA8gYAAPIGAADzBwEA8gYAAPMHAQDzBwEA8wcBAPIGAgDyhoKA8oaCgPMHAQDyBgIA8gYCAPIGAgDyBgAA8wcBAPIGAADyBgAA8gYAAPOXkZD6BgAA/gYAAP4GAAD+CgQE/gYAAP4GAAD+CgQE/goEBP4GAAD+BgAA/gYAAP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4OCgj6BgIA8oaCgPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYCAPIGAADyBgAA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8gYCAPIGAADyBgAA8gYAAPKGgoDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAwDyBgAA8wcBAPIGAADzBwEA8gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8wcBAPMHAQDyhoKA8oaCgPKGgoDyBgIA8gYCAPIGAADzBwEA8wcBAPMHAQDyBgAA8AAAAAIGAADyBgAA8gYCAO8HAQDyzsrI+gYAAP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+BgAA/goEBP4GAAD+BgAA/gYAAP4KBAT+CgQE/g4ICP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+BgAA/oaCgPoGAgDuBgAA8gYCAO4GAgDzBwEA8wcBAPMHAQDyBgAA8gYCAO4GAADyBgAA8gYCAPMHAQDzBwEA8wcBAPIGAADyBgAA8gYCAPMHAQDzBwEA8gYCAPMHAQDyBgAA8gYCAPIGAADyBgAA8gYCAPIGAgDyBgIA8wcBAPIGAADzBwEA8wcBAPIGAgDuhoKA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8gYCAPIGAADyBgAA8gYAAPMHAQDwAAAAAwcBAPMHAQDyBgAA8gYCAPIGAgDyhoKA8oaCgPKGgoDyBgIA8wcBAPIGAgDyBgIA8wcBAPMHAQDyBgIA8gYAAPMHAQDyBgIA7gYAAPMHAQDyBgAA94eDgPoGAAD+BgAA/gYAAP4GAAD+CgQE/g4ICP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4GAAD+BgAA/gYAAP4GAAD/j4uI+kZCQPYGAADyBgIA7wcBAPMHAQDyBgIA8oaCgPMHAQDyBgIA7wcBAPIGAgDzBwEA8gYAAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPMHAQDyBgIA8wcBAPIGAgDyBgAA8wcBAPMHAQDyBgIA8wcBAPIGAgDvBwEA8gYAAPIGAADzBwEA8gYCAO4GAADyBgIA7gYCAPMHAQDyBgIA8gYAAPMHAQDzBwEA8wcBAPMHAQDyBgIA7wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgIA8gYCAPIGAADzBwEA8gYCAPIGAgDzBwEA8wcBAPMHAQDyBgAA8gYCAPIGAgDzBwEA8wcBAPMHAQDyBgAA8gYAAPoGAAD+BgAA/gYAAP4KBAT+CgQE/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+BgAA/goEBP4KBAT+BgAA/goEBP4GAAD+BgAA/goEBP4KBAT/R0NA9gYCAPIGAgDzBwEA8gYCAPIGAgDzBwEA8wcBAPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAgDyhoKA8gYCAPIGAADzBwEA8gYAAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgAA8gYCAPMHAQDyBgAA8gYAAPMHAQDyBgAA8wcBAPIGAgDyBgAA8gYCAO4GAgDuBgAA8gYCAO4GAADzBwEA8wcBAPIGAgDzBwEA8wcBAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDzBwEA8wcBAPMHAQDyBgAA8gYAAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPJOSkj6BgAA/gYAAP4KBAT+DggI/gYAAP4KBAT+CgQE/goEBP4GAAD+BgAA/goEBP4KBAT+CgQE/goEBP4GAAD+BgAA/gYAAP4GAAD+BgAA/goEBP4WEhD6BgAA8gYCAPIGAgDzBwEA8gYAAPMHAQDyBgIA8wcBAPIGAgDyBgIA8gYCAPIGAgDyBgIA8gYAAPIGAgDyBgIA7gYCAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8gYAAPIGAADzBwEA8wcBAPIGAADzBwEA8gYAAPIGAgDuBgAA8gYAAPMHAQDyBgIA7wcBAPIGAADzBwEA8wcBAPMHAQDyBgAA8wcBAPIGAADyBgIA8gYAAPMHAQDyBgAA8gYAAPIGAgDyBgAA8wcBAPMHAQDyBgIA8gYCAPMHAQDyBgAA8oaCgPIGAADyBgIA7wcBAPMHAQDzBwEA8gYAAPMHAQDzBwEA8wcBAPMHAQDyBgIA8gYCAO5GQED3j4uI+gYAAP4OCAj+CgQE/goEBP4OCAj+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+BgAA/gYAAP4GAAD+CgQE/5eTkPoGAgDzBwEA8oaCgPIGAgDzBwEA8wcBAPMHAQDyhoKA8gYCAPIGAADzBwEA8oaCgPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYAAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8gYAAPIGAADzBwEA8wcBAPIGAgDyhoKA8wcBAPMHAQDyBgIA8gYAAPIGAgDyBgAA8oaCgPIGAADzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDyBgIA8wcBAPIGAgDzBwEA8gYAAPIGAgDzBwEA8wcBAPMHAQDyBgIA8gYCAPIGAgDzBwEA8gYCAPIGAgDyBgAA8gYAAPIGAADyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAgDzBwEA8gYAAPIGAADyJiAg+goEBP4KBAT+DggI/goEBP4OCAj+CgQE/g4ICP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+CgQE/qagoPoGAADyBgAA8gYAAPIGAADyBgIA8gYCAPIGAADyBgIA8gYCAO8HAQDyBgAA8wcBAPIGAADyBgAA8gYCAPIGAADyBgIA7gYAAPIGAADyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPMHAQDyBgAA8wcBAPIGAADyBgAA8gYAAPMHAQDyBgIA8wcBAPIGAgDyBgIA7wcBAPKGgoDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8gYCAPIGAgDvBwEA8gYAAPIGAgDvBwEA8gYCAPKGgoDyBgIA8gYCAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDyBgIA8gYAAPIGAADzBwEA8wcBAPAAAAACBgAA8gYCAO4GAADyBgIA7s7KyPoGAAD+BgAA/gYAAP4GAAD+CgQE/g4ICP4GAAD+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/gYAAP4KBAT+lpKQ+gYCAPMHAQDzBwEA8wcBAPKGgoDyBgIA8gYCAPMHAQDzBwEA8gYCAPMHAQDzBwEA8gYCAPMHAQDzBwEA8gYAAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8gYCAPIGAADyBgAA8gYAAPIGAgDvBwEA8gYCAPMHAQDzBwEA8gYCAPIGAgDzBwEA8gYAAPIGAADyBgAA8wcBAPKGgoDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAgDyBgIA8gYCAPIGAADyBgAA8gYCAO4GAADyBgIA8wcBAPIGAgDyhoKA8gYCAPIGAADzBwEA8gYCAPMHAQDyBgIA8wcBAPIGAADzBwEA8oaCgPIGAgDyBgIA8gYAAPIGAADzBwEA8wcBAPIGAgDzBwEA8gYAAPIGAADyBgAA8iYiIPfHw8D6BgAA/gYAAP4GAAD+BgAA/goEBP4KBAT+CgQE/g4ICP4OCAj+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+JiIg9wcBAPMHAQDzBwEA8gYCAO4GAgDyBgAA8wcBAPMHAQDyhoKA8wcBAPMHAQDyBgAA8gYCAPMHAQDyhoKA8wcBAPIGAADzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDyBgIA8gYCAPIGAgDyBgAA8gYCAO4GAgDvBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgAA8gYAAPIGAgDyBgIA8gYCAPIGAADzBwEA8gYCAPIGAgDzBwEA8oaCgPMHAQDzBwEA8gYCAPIGAgDzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAgDyBgAA8wcBAPIGAADyBgAA8gYCAO8HAQDzBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPIOCgj6BgAA/gYAAP4GAAD+BgAA/gYAAP4KBAT+DggI/goEBP4KBAT+CgQE/goEBP4OCAj+CgQE/goEBP6WkpD6BgIA8gYCAPIGAgDzBwEA8wcBAPKGgoDzBwEA8wcBAPIGAADzBwEA8gYAAPMHAQDyBgAA8wcBAPIGAgDuBgAA8gYAAPIGAADzBwEA8wcBAPIGAADzBwEA8oaCgPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDyBgIA8gYCAPIGAADyBgIA8wcBAPIGAgDyBgAA8gYCAPIGAADyBgAA8AAAAAIGAADyBgAA8wcBAPIGAADyBgIA8gYAAPIGAADzBwEA8wcBAPIGAADyBgIA8wcBAPMHAQDzBwEA8wcBAPKGgoDyBgIA8wcBAPIGAgDyBgIA8gYCAPJGQED3z8vI+gYAAP4GAAD+DggI/goEBP4GAAD+CgQE/g4ICP4KBAT+CgQE/goEBP4KBAT+CgQE/4+LiPpmYmD3BwEA8wcBAPKGgoDyBgIA8gYCAPMHAQDzBwEA8wcBAPIGAADzBwEA8wcBAPIGAgDyBgAA8gYAAPKGgoDzBwEA8gYCAPKGgoDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAADzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPIGAgDyBgIA8wcBAPMHAQDzBwEA8gYCAPIGAADzBwEA8wcBAPIGAgDzBwEA8gYAAPMHAQDzBwEA8gYAAPMHAQDyBgIA7gYAAPIGAADyBgAA8AAAAAMHAQDzBwEA8wcBAPAAAAACBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDuBgAA8gYAAPMHAQDzBwEA8gYCAPIGAgDyBgIA8gYCAPIGAgDzBwEA8wcBAPIGAADyDgoI+goEBP4KBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/goEBP4KBAT+CgQE/g4KCPsHAQDyhoKA8oaCgPIGAgDzBwEA8gYCAPMHAQDyBgAA8gYAAPMHAQDzBwEA8gYAAPKGgoDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgIA8gYCAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAgDyBgIA8wcBAPMHAQDyBgIA8wcBAPIGAgDuBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDzBwEA8oaCgPIGAADyBgAA8gYAAPIGAgDuBgIA7gYCAO8HAQDyBgIA7gYCAO4GAADyBgAA8wcBAPMHAQDyBgIA7wcBAPMHAQDyBgIA8gYAAPIGAgDuBgAA8gYAAPMHAQDzBwEA8gYCAPIGAgDyBgIA8oaCgPIGAgDzBwEA8gYCAPIGAADyhoCA98/LyPoKBAT+CgQE/goEBP4GAAD+CgQE/goEBP4KBAT+BgAA/gYAAP4KBAT+CgQE/mZiYPYGAADyBgIA8oaCgPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAADzBwEA8gYCAPIGAgDzBwEA8oaCgPIGAgDvBwEA8gYCAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8gYCAPIGAgDzBwEA8gYCAPIGAADzBwEA8wcBAPMHAQDyBgIA8gYAAPMHAQDzBwEA8gYCAPIGAADyBgAA8wcBAPMHAQDzBwEA8gYAAPIGAgDzBwEA8wcBAPMHAQDyBgIA8gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgIA8gYAAPIGAgDuBgIA7wcBAPMHAQDyBgAA8gYAAPMHAQDzBwEA8gYCAPIGAADyBgAA8gYAAPIGAADzBwEA8wcBAPIGAgDyBgIA8gYCAPIGAgDzBwEA8wcBAPIGAADyBgAA8hYSEPoKBAT+BgAA/goEBP4GAAD+CgQE/goEBP4GAAD+CgQE/gYAAP4KBAT+lpKQ+gYCAPIGAgDzBwEA8gYCAPMHAQDzBwEA8gYCAPIGAgDyBgIA8wcBAPIGAADzBwEA8gYAAPIGAgDuBgIA7wcBAPIGAgDuBgAA8gYCAPIGAADyBgAA8gYCAPMHAQDyBgIA8wcBAPIGAgDyBgIA8wcBAPIGAgDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDyhoKA8wcBAPMHAQDzBwEA8wcBAPIGAgDuBgAA8gYCAPMHAQDzBwEA8wcBAPIGAADzBwEA8wcBAPIGAgDzBwMA8wcBAPMHAQDzBwEA8AAAAAIGAADzBwEA8AAAAAIGAADyBgIA8gYAAPIGAgDvBwEA8oaCgPIGAgDyBgAA8wcBAPIGAADwAAAAAgYAAPMHAQDyBgAA8gYCAO4GAADzBwEA8wcBAPIGAgDyBgIA8gYCAPIGAgDzBwEA8gYAAPIGAADyBgAA8kZCQPYKBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/goEBP4KBAT+RkJA9wcBAPIGAgDyBgIA8gYCAPKGgoDzBwEA8wcBAPKGgoDzBwEA8wcBAPMHAQDyBgIA7gYCAO4GAADyBgIA8gYAAPIGAADyBgIA7gYCAO4GAgDyBgAA8gYCAPIGAgDzBwEA8wcBAPMHAQDyBgIA8wcBAPIGAgDyBgIA8gYCAPMHAQDyBgIA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgAA8wcBAPMHAQDyBgAA8wcBAPMHAQDyBgAA8gYCAO8HAQDzBwEA8wcBAPMHAQDzBwEA8gYCAO4GAgDvBwEA8gYAAPIGAADyBgAA8gYCAO4GAADzBwEA8wcBAPIGAADyBgAA8wcBAPMHAQDyBgIA7gYCAO8HAQDyBgAA8AAAAAIGAADyBgAA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYAAPMPCwj6BgAA/gYAAP4KBAT+CgQE/goEBP4KBAT+BgAA/goEBP7Oysj6BgIA8wcBAPIGAgDyBgIA8gYCAPIGAgDyBgIA8oaCgPKGgoDyBgIA8gYCAPIGAgDvBwEA8gYAAPMHAQDyBgAA8gYAAPIGAgDvBwEA8gYAAPMHAQDzBwEA8gYAAPMHAQDzBwEA8gYCAPIGAgDyBgAA8wcBAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAgDuBgAA8wcBAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8gYAAPIGAADyBgAA8wcBAPIGAgDuBgAA8gYAAPMHAQDyBgIA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8gYAAPIGAgDuBgAA8gYCAO4GAADzBwEA8gYAAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDyBgIA8gYAAPIGAAD6BgAA/gYAAP4KBAT+CgQE/goEBP4OCAj+BgAA/goEBP6WkJD7BwEA8wcBAPIGAADyBgAA8gYCAPKGgoDyBgIA7wcBAPMHAQDzBwEA8wcBAPKGgoDyBgIA8gYCAO4GAADwAAAAAgYCAO4GAADzBwEA8gYAAPIGAgDwAAAAAgYAAPMHAQDyBgIA8wcBAPMHAQDzBwEA8gYAAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8gYAAPIGAADyBgIA8oaCgPMHAQDyBgAA8gYAAPMHAQDzBwEA8gYAAPIGAgDuBgAA8wcBAPIGAgDuBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADyBgIA8wcBAPIGAgDyBgIA8gYCAPIGAgDzBwEA8wcBAPIGAADyhoKA8wcBAPMHAQDzz8vI+goEBP4KBAT+CgQE/goEBP4OCAj+CgQE/4+LiPoGAgDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDzBwEA8wcBAPKGgoDyBgIA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgAA8gYCAO4GAADzBwEA8wcBAPIGAADyBgAA8wcBAPIGAADzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAADyBgAA8wcBAPIGAADyBgAA8gYAAPIGAgDvBwEA8gYAAPIGAADyBgAA8wcBAPKGgoDyBgAA8gYCAPIGAgDyhoKA8oaCgPIGAgDzBwEA8gYCAPMHAQDzBwEA8gYAAPIGAADyBgAA8wcBAPAAAAADBwEA8wcBAPIGAgDuBgIA7gYAAPIGAgDyBgAA8wcBAPIGAADyBgIA7gYAAPMHAQDyBgIA7gYCAO4GAgDvBwEA8wcBAPMHAQDyBgIA8gYCAPIGAgDzBwEA8oaCgPMHAQDzBwEA8wcBAPIGAADyVlJQ+goEBP4KBAT+CgQE/goEBP4KBAT+CgQE/paSkPoGAgDyBgIA8wcBAPMHAQDyhoKA8gYCAPIGAgDzBwEA8wcBAPMHAQDzBwEA8gYAAPIGAgDyBgIA8gYAAPIGAADyBgAA8gYCAPIGAADzBwEA8gYAAPIGAgDvBwEA8oaCgPIGAgDyBgIA8gYAAPIGAADzBwEA8gYCAPIGAgDzBwEA8gYCAPIGAgDyBgAA8oaCgPIGAADzBwEA8wcBAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYCAPIGAgDzBwEA8gYCAPMHAQDzBwEA8gYCAPIGAgDyBgIA8gYCAPMHAQDzBwEA8gYAAPMHAQDyBgIA7gYAAPIGAgDuBgAA8gYAAPIGAADzBwEA8gYAAPIGAADyBgIA8wcBAPIGAADwAAAAAgYAAPIGAADyBgAA8gYAAPIGAADyBgIA7wcBAPIGAgDyBgIA8gYAAPIGAADzBwEA8gYAAPMHAQDzBwEA8wcBAPMHAQDyJiAg+goEBP4KBAT+CgQE/gYAAP4KBAT+BgAA/iYgIPoGAADyBgIA8gYAAPMHAQDyBgIA8wcBAPIGAgDyBgIA8gYCAPIGAgDzBwEA8gYAAPIGAADzBwEA8gYCAO4GAgDuBgIA7gYAAPIGAADyBgAA8gYAAPMHAQDyBgAA8wcBAPIGAADyBgAA8gYCAO4GAADyhoKA8gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7gYAAPAAAAACBgAA8gYCAO4GAgDvBwEA8gYCAPIGAADyBgAA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgIA8gYCAPIGAgDyBgIA8gYCAPMHAQDyhoKA8wcBAPIGAgDyBgAA8wcBAPMHAQDyBgAA8AAAAAIGAgDuBgIA8wcBAPAAAAACBgAA8wcBAPIGAgDuBgAA8gYAAPIGAADzBwEA8gYAAPIGAADyBgAA8gYCAO4GAADyBgIA8gYCAO8HAQDyBgAA8wcBAPMHAQDyBgAA8wcBAPMHAQDyBgAA88/LyPoGAAD+CgQE/goEBP4KBAT/j4uI+gYAAPMHAQDzBwEA8wcBAPMHAQDyBgIA8gYCAPKGgoDyBgIA8gYCAPIGAgDyBgIA7gYCAO8HAQDyBgAA8gYAAPIGAADyBgIA7gYAAPIGAgDsAAAAAAAAAAMHAQDyBgAA8gYAAPIGAgDuBgAA8gYAAPIGAADyBgAA8wcBAPIGAgDuBgIA7gYAAPMHAQDwAAAAAgYAAPIGAgDuBgIA7gYAAPMHAQDzBwEA8gYAAPMHAQDyBgAA8gYCAPIGAgDzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDyBgAA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgAA8gYAAPKGgoDyBgAA8wcBAPIGAADyBgAA8gYAAPMHAQDyBgAA8gYAAPIGAADyBgIA7wcBAPIGAgDzBwEA8gYAAPAAAAACBgAA8gYAAPMHAQDzBwEA8wcBAPMHAQDyBgIA8wcBAPMHAQDyBgAA8paSkPoKBAT+CgQE/goEBP4KBAT+hoKA+gYAAPMHAQDyhoKA8gYCAPIGAADyBgIA8gYCAPMHAQDyBgIA8oaCgPIGAADyBgAA8gYAAPMHAQDzBwEA8oaCgPIGAgDyBgIA7gYCAPIGAADyBgAA8wcBAPIGAgDyhoKA8wcBAPIGAADyhoKA8gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYAAPIGAADyBgAA8gYAAPIGAADzBwEA8gYAAPMHAQDyBgAA8gYAAPIGAADzBwEA8wcBAPIGAgDyBgAA8wcBAPIGAADzBwEA8gYAAPIGAADzBwEA8gYAAPMHAQDyBgIA8gYAAPIGAgDyBgIA8wcBAPMHAQDwAAAAAgYCAO8HAQDyBgAA8gYCAOwAAAACBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDvBwEA8wcBAPMHAQDzBwEA8gYAAPIGAADyBgIA7wcBAPMHAQDzBwEA8gYAAPMHAQDyBgIA8wcBAPMHAQDzBwEA8xcREPoKBAT+CgQE/goEBP4KBAT+pqCg+wcBAPIGAgDyBgIA8wcBAPIGAADzBwEA8gYCAPIGAgDyBgIA8wcBAPMHAQDyBgIA8gYCAPIGAADyBgAA8gYCAPMHAQDyBgIA7wcBAPIGAADyBgAA8wcBAPIGAADzBwEA8wcBAPIGAgDuBgAA8gYCAO4GAADyBgAA8gYAAPIGAgDuBgAA8gYAAPIGAgDuBgAA8gYAAPIGAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDuBgAA8gYAAPMHAQDzBwEA8gYAAPIGAADyBgIA8wcBAPMHAQDzBwEA8wcBAPIGAgDzBwEA8gYCAPMHAQDzBwEA8wcBAPIGAgDzBwEA8wcBAPIGAADzBwEA8gYCAO4GAADzBwEA8gYAAPIGAADzBwEA8wcBAPMHAQDzBwEA8wcBAPMHAQDzBwEA8gYCAPMHAQDzBwEA8wcBAPMHAQDyBgIA8gYCAPMHAQDzBwEA8wcBAPIGAADyBgAA8kZAQPYGAAD+CgQE/goEBP4KBAT+JiIg9gYCAPIGAgDyBgIA8wcBAPIGAgDyBgAA8gYCAPMHAQDyBgAA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgAA8gYAAPIGAADyBgIA7gYAAPMHAQDyBgIA7gYCAO4GAgDsAAAAAgYCAO4GAADyBgAA8wcBAPIGAADyBgAA8gYCAO4GAADzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAADyBgIA7gYAAPIGAgDyBgIA7gYAAPAAAAACBgAA8wcBAPMHAQDzBwEA8wcBAPIGAADzBwEA8wcBAPIGAgDyBgAA8wcBAPIGAgDzBwEA8wcBAPKGgoDyBgAA8wcBAPIGAADzBwEA8AAAAAIGAADyBgIA7gYAAPMHAQDyBgAA8gYAAPIGAADyBgAA8wcBAPIGAADzBwEA8gYCAPIGAADyBgIA7wcBAPIGAgDyBgIA8gYAAPMHAQDyBgIA8gYCAPMHAQDyBgIA8wcBAPMHAQDyBgAA8wcBAPOXkZD7h4OA+8/LyPunoaD7BwEA8gYCAPIGAgDzBwEA8gYAAPIGAgDvBwEA8wcBAPIGAADyBgIA8wcBAPIGAADyBgIA8wcBAPMHAQDyBgAA8gYAAPIGAADyBgAA8gYAAPIGAgDvBwEA8wcBAPIGAgDuBgAA8gYAAPIGAgDuBgAA8wcBAPIGAgDyBgIA7gYCAO4GAADzBwEA8wcBAPMHAQDzBwEA8wcBAPIGAgDuBgIA7gYCAPMHAQDyBgIA7gYAAPIGAADyBgAA8",
    "96-20260520": "wcBAPIGAgDsAAAAAgYCAOwAAAACBgIA7AAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7gYAAPIGAADwAAAAAAAAAAIGAADyBgAA8gYCAO4GAgDsAAAAAgYCAOwAAAAAAAAAAgYCAO4GAgDuBgIA7gYCAO4GAADyBgAA8AAAAAAAAAACBgIA7gYAAPIGAgDuBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgAA8gYCAO4GAgDsAAAAAwcBAPaGgID719HQ+g4KCPsHAQD7R0FA9AAAAAAAAAAAAAAAAAAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgAA8gYCAO4GAgDuBgAA8gYAAPAAAAAAAAAAAgYAAPIGAADyBgIA7gYCAO4GAgDuBgAA8AAAAAIGAgDuBgAA8gYAAPAAAAAAAAAAAgYAAPIGAADwAAAAAAAAAAAAAAACBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAwcBAPIGAADwAAAAAgYCAOwAAAACBgIA7gYCAOwAAAAAAAAAAgYCAOwAAAACBgIA7gYCAO4GAADyBgIA7AAAAAIGAADyBgAA8gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDsAAAAAgYAAPAAAAACBgIA7AAAAAAAAAACBgIA7gYAAPAAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDuBgAA8AAAAAIGAgDvBwEA8kZCQPcXERD6JiIg+j46OPtnYWD6hoKA9wcBAPAAAAACBgAA8gYCAOwAAAACBgIA7gYAAPAAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDuBgIA7gYAAPAAAAAAAAAAAgYCAO4GAADwAAAAAAAAAAIGAgDuBgAA8gYCAOwAAAACBgAA8gYAAPAAAAAAAAAAAgYCAO4GAADwAAAAAAAAAAAAAAACBgIA7AAAAAIGAADwAAAAAgYCAO4GAADwAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgDuBgAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAO8HAQDyBgIA7gYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7gYAAPIGAgDuBgIA7AAAAAAAAAACBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAADBwMA80dDQPd3cXD6bmpo+nZycPu3sbD7p6Og94eDgPAAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDuBgAA8AAAAAAAAAACBgIA7AAAAAIGAgDuBgIA7gYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAIGAADyBgAA8gYCAOwAAAAAAAAAAAAAAAAAAAACBgAA8gYCAO4GAADyBgIA7AAAAAIGAADyBgIA7AAAAAIGAgDuBgIA7gYCAO4GAgDsAAAAAgYAAPIGAADwAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDvBwEA8gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDvh4GA9oaAgPoeGhj6xsLA+sbCwPoeGhj6lpCQ+4eBgPQAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDuBgIA7gYCAO4GAgDuBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAAAAAAIGAADyBgIA8gYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAgYAAPIGAADwAAAAAgYAAPIGAADyBgAA8AAAAAAAAAACBgAA8wcBAPIGAgDuBgAA8gYAAPMHAQDwAAAAAAAAAAIGAgDuBgAA8gYCAO4GAgDuBgAA8gYAAPAAAAAAAAAAAgYAAPMHAQDwAAAAAgYCAO4GAADyBgAA8AAAAAIGAgDvJyMg90dBQPpmYmD65uLg+ubi4PpeWlj7JyEg+wcDAPYGAADyBgAA8gYCAO4GAgDuBgIA7gYCAOwAAAAAAAAAAgYAAPIGAADyBgIA7AAAAAIGAADyBgAA8AAAAAAAAAACBgAA8gYAAPAAAAACBgAA8gYAAPIGAADwAAAAAAAAAAIGAADyBgAA8gYCAO4GAADwAAAAAgYCAOwAAAAAAAAAAgYAAPIGAADwAAAAAgYCAO8HAQDyBgAA8AAAAAAAAAACBgAA8wcBAPIGAgDuBgIA7AAAAAIGAADwAAAAAAAAAAIGAADyBgAA8AAAAAAAAAAAAAAAAgYCAOwAAAACBgIA7wcBAPIGAADwAAAAAgYCAO4GAgDuBgAA8gYCAO4GAgDuBgAA8gYAAPAAAAACBgAA8gYAAPIGAADwAAAAAAAAAAIGAADyBgAA8gYCAO4GAgDuBgIA7wcBAPAAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7gYAAPIGAgDzp6Og92dhYPpmYmD63trY+t7a2PpeWlj7V1FQ+6ejoPYGAgDyBgIA7AAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAO4GAADwAAAAAgYCAO4GAgDuBgAA8gYCAOwAAAACBgIA7gYAAPAAAAAAAAAAAgYCAO4GAADwAAAAAAAAAAIGAADyBgAA8AAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAO4GAADwAAAAAgYCAO4GAgDuBgAA8AAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAAAAAACBgIA7AAAAAIGAgDuBgIA7gYAAPAAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAAAAAAAAAAAAgYCAO4GAgDuBgAA8AAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwcBAPNHQUD2dnBw+6ehoPpWUlD6xsLA+sbCwPpWUlD7p6Gg+nZwcPtHQUD3BwEA8AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAAAAAAAAAAAAgYCAO4GAADyBgIA7gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDuBgAA8AAAAAIGAADyBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDsAAAAAgYCAO4GAADwAAAAAwcDAPLm4uD3R0FA+hYSEPpeWlj6rqqo+q6qqPpeWlj6DgoI+1dRUPrm4uD2BgIA8AAAAAIGAgDuBgAA8AAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDsAAAAAgYAAPIGAgDsAAAAAgYCAOwAAAACBgIA7gYAAPAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAgYAAPIGAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYAAPIGAADwAAAAAgYCAO4GAADyBgAA8AAAAAAAAAACBgIA7gYAAPIGAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAIGAADzBwEA8gYCAO4GAgDuBgIA7gYAAPAAAAAAAAAAAgYAAPMHAQDwAAAAAgYCAO4GAgDuBgAA8AAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgIA7wcDAPOHg4D3x8HA+jYyMPpmYmD6npqY+q6qqPpmYmD6NjIw+9fR0PuHg4D3BwMA8AAAAAAAAAACBgAA8gYAAPAAAAAAAAAAAgYAAPIGAADwAAAAAAAAAAMHAQDyBgAA8AAAAAIGAgDuBgIA7gYAAPIGAgDuBgIA7gYCAO4GAgDsAAAAAgYCAO4GAADyBgAA8AAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgAA8AAAAAIGAADwAAAAAgYCAOwAAAAAAAAAAgYCAO4GAADwAAAAAgYAAPIGAADyBgAA8gYCAOwAAAACBgIA7gYAAPIGAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAADyBgAA8gYCAO4GAgDuBgAA8gYAAPIGAgDsAAAAAgYAAPIGAADwAAAAAgYCAO4GAgDuBgAA8AAAAAAAAAACBgIA7gYAAPAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAgDuBgAA8sbAwPaGgID6Pjo4+m5qaPpuamj6joqI+o6KiPpmYmD6bmpo+kZCQPqGgID7R0FA9gYCAOwAAAACBgAA8gYAAPAAAAACBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDuBgAA8AAAAAIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDuBgAA8AAAAAAAAAACBgIA7gYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAACBgIA7AAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDuBgAA8gYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7gYAAPIGAADyBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAACBgIA7AAAAAAAAAADBwEA8ubi4Pc3MTD6hoKA+paSkPpuamj6fnp4+n56ePpuamj6joqI+oaCgPtHQUD7JyMg9gYCAPIGAgDuBgAA8gYAAPIGAADyBgIA7AAAAAAAAAACBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDsAAAAAgYAAPAAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgIA7gYCAO4GAADyBgAA8AAAAAIGAgDsAAAAAgYCAO4GAADyBgIA7gYAAPIGAgDsAAAAAgYCAO4GAgDsAAAAAgYAAPIGAgDuBgIA7AAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAO4GAgDuBgAA9jYwMPvHwcD6pqKg+qaioPpuamj6dnJw+nZycPpuamj6npqY+paSkPvn4eD6hoCA+8fBwPYGAgDuBgAA8gYAAPAAAAACBgIA7AAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAAAAAAAAAAAAgYCAOwAAAACBgIA7gYCAO4GAgDuBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAIGAADyBgAA8AAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAgYAAPIGAgDsAAAAAgYCAO4GAgDuBgAA8AAAAAAAAAACBgAA8wcBAPIGAgDuBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADzBwEA8gYCAO4GAgDsAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADwAAAAAgYCAO4GAADy5uLg9vbw8PouKij6trKw+q6qqPp2cnD6bmpo+m5qaPp2cnD6npqY+qaioPpOSkj7l5GQ+iYgIPqGgID2BgAA8AAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAACBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADyBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAIGAgDuBgIA7AAAAAIGAADyBgAA8AAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAO4GAADwAAAAAgYCAO4GAADyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7AAAAAIGAgDuBgAA8gYCAOwAAAAAAAAAAgYCAOwAAAAAAAAAAgYAAPIGAADwAAAAAgYAAPIGAAD2JiAg+3dxcPo+Ojj6pqKg+paSkPp2cnD6bmpo+m5qaPp2cnD6joqI+paSkPpeWlj6DgoI+ubg4PoGAgD2BgAA8gYCAOwAAAAAAAAAAgYCAO4GAADyBgIA7gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDuBgAA8gYCAO4GAgDsAAAAAgYAAPIGAADwAAAAAgYAAPIGAADyBgIA7gYCAOwAAAACBgIA7AAAAAAAAAACBgAA8gYAAPIGAgDuBgIA7AAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYAAPIGAgDsAAAAAAAAAAIGAADyBgIA7AAAAAIGAgDuBgIA7gYCAO4GAgDuBgAA8gYCAO4GAgDsAAAAAgYCAO4GAgDuBgAA8gYAAPIGAADwAAAAAAAAAAIGAgDuBgIA7gYCAO4GAgDsAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAwcBAPImIiD3FxEQ+g4KCPpOSkj6joqI+o6KiPpuamj6bmpo+m5qaPpuamj6hoKA+oaCgPpeWlj6RkJA+7exsPrGwsD2hoKA8AAAAAIGAgDsAAAAAAAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAO4GAgDsAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAACBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA7gYCAOwAAAACBgIA7gYAAPIGAgDuBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAsbAwPYmICD6HhoY+nZycPpmYmD6fnp4+n56ePpuamj6bmpo+m5qaPpuamj6dnJw+nZycPp2cnD6lpKQ+k5KSPp2cHD7x8HA9AAAAAIGAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYAAPIGAADwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAIGAADyBgIA7AAAAAIGAADwAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADwAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAACBgAA8gYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAkZCQPbm4OD6XlpY+qaioPp2cnD6dnJw+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+n56ePp2cnD6pqKg+nZycPsnISD7Z2Ng9gYCAPAAAAACBgAA8AAAAAIGAgDsAAAAAAAAAAIGAADyBgIA7AAAAAIGAADwAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgAA8gYCAOwAAAACBgIA7gYCAO4GAADyBgIA7AAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAgYAAPIGAADwAAAAAAAAAAAAAAACBgIA7gYCAOwAAAACBgIA7gYAAPAAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYCAO4GAgDuBgAA8wcBAPAAAAACBgIA7AAAAAIGAgDuhoCA9kZAQPvHwcD6lpKQ+raysPqGgoD6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPp+enj6rqqo+o6KiPv38fD6xsDA+oaCgPYGAgDyBgIA7AAAAAIGAgDuBgIA7AAAAAIGAADyBgIA7AAAAAIGAADwAAAAAAAAAAAAAAAAAAAAAgYCAO4GAADyBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgIA7gYCAO4GAADyBgAA8gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgIA7gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDuBgIA7gYAAPIGAgDuBgIA7AAAAAIGAAD35+Pg94eBgPo+Ojj6pqKg+q6qqPqGgoD6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPp+enj6npqY+o6KiPo2MjD7t7Gw+jYwMPpGQED2BgIA7AAAAAIGAgDuBgAA8AAAAAAAAAACBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAgYAAPIGAgDuBgIA7gYCAO8HAQDyBgIA7gYCAOwAAAACBgIA7gYAAPIGAADwAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAAAAAAAAgYCAOwAAAAAAAAAAgYAAPIGAgDsAAAAAAAAAAAAAAACBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDuBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAAAAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAACBgIA7gYAAPPHwcD3BwEA+kZCQPpmYmD6hoKA+o6KiPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6hoKA+n56ePpWUlD6Lioo+tbQ0PsHAQD0AAAAAAAAAAIGAgDuBgAA8AAAAAAAAAAAAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYAAPIGAADyBgIA7gYAAPIGAgDuBgAA8gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAgYAAPIGAADwAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAAAAAAAAkZAQPYWEBD6JiIg+r66uPqWkpD6bmpo+nZycPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6fnp4+nZycPp+enj6joqI++fh4PuHg4D2BgAA9gYAAPIGAADwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgAA8wcBAPAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAMHAQDyBgAA8AAAAAIGAgDuBgIA7gYAAPAAAAAAAAAAAgYAAPIGAADyBgIA7gYAAPAAAAAAAAAAAAAAAAAAAAACBgAA8gYAAPIGAgDuBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgAA8AAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAgYAAPIGAADwAAAAAAAAAAAAAAACBgIA7gYCAOwAAAACBgIA7gYAAPAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAACBgAA8ubi4PcXERD6RkJA+sbCwPqWkpD6dnJw+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPp2cnD6dnJw+m5qaPqGgoD6pqKg+j46OPrm4OD7BwMA9gYCAPIGAgDsAAAAAAAAAAAAAAACBgIA7gYCAOwAAAACBgIA7wcBAPIGAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAADyBgIA7AAAAAIGAgDuBgAA8gYAAPAAAAACBgIA7gYAAPIGAADyBgIA7gYAAPIGAgDuBgIA7AAAAAIGAgDuBgAA8gYAAPIGAgDuBgAA8AAAAAIGAgDsAAAAAAAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAACBgAA8AAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDyBgIA9ubg4Pvn4eD6XlpY+qaioPqGgoD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPqGgoD6lpKQ+l5aWPoOCgj7JyEg+oaCgPcHAwDwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIGAgDuBgIA7gYAAPAAAAACBgIA7gYAAPIGAADyBgAA8gYAAPAAAAAAAAAAAAAAAAIGAgDuBgAA8gYAAPIGAgDuBgAA8AAAAAAAAAACBgIA7AAAAAAAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7AAAAAIGAgDuBgIA7gYCAO4GAgDuBgIA7AAAAAIGAgDuBgAA8oaCgPJmYmD2trCw+h4aGPpWUlD6dnJw+oaCgPp+enj6dnJw+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6hoKA+nZycPpuamj6Pjo4+vbw8PqmoqD3BwEA8gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAAAAAAIGAgDuBgAA8gYAAPIGAgDuBgIA7gYAAPIGAADyBgIA7gYAAPIGAgDuBgIA7gYCAOwAAAACBgAA8gYAAPAAAAACBgIA7gYAAPIGAADwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgAA8wcBAPAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAIGAADzBwEA8AAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAgYAAPMHAQDyBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgAA80dBQPY2MDD7h4GA+nZycPqWkpD6bmpo+nZycPp+enj6fnp4+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6fnp4+oaCgPqOioj6dnJw+6ehoPpGQED6hoCA9AAAAAIGAADyBgIA7AAAAAIGAADwAAAAAgYCAOwAAAAAAAAAAgYAAPMHAQDwAAAAAgYCAO4GAgDuBgAA8AAAAAAAAAACBgAA8wcBAPIGAgDuBgAA8gYCAO4GAgDuBgIA7gYCAO4GAADyBgIA8gYCAO4GAgDuBgIA7gYAAPIGAgDuBgIA7gYAAPMHAQDwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgIA7gYAAPIGAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAADyBgAA8gYCAO4GAgDsAAAAAgYCAO4GAgDsAAAAAgYCAO4GAADyBgIA7gYCAOwAAAACBgIA7gYAAPIGAgDyhoCA9iYgIPt3cXD6Pjo4+q6qqPquqqj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+n56ePqempj6pqKg+jYyMPt3cXD6FhAQ+oaAgPcHAQDyBgIA7AAAAAIGAADwAAAAAAAAAAIGAgDsAAAAAgYAAPIGAADyBgAA8gYCAO4GAADyBgAA8gYCAO4GAgDuBgIA7gYAAPIGAADyBgIA7gYAAPIGAADyBgIA7gYAAPIGAADyBgAA8gYCAO4GAgDuBgAA8gYCAO4GAADyBgIA7AAAAAIGAgDuBgAA8gYCAOwAAAACBgIA7gYCAOwAAAAAAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDuBgAA8gYCAOwAAAACBgIA7gYCAO6GgID3p6Og91dRUPo2MjD6dnJw+qaioPqWkpD6dnJw+mZiYPp2cnD6dnJw+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+n56ePqOioj6pqKg+nZycPo2MjD7V1FQ+2djYPZGQED0AAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAADyBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAO4GAADyBgAA8gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAgYCAOwAAAAAAAAAAwcBAPLm4uD21tDQ+h4aGPp2cnD6bmpo+oaCgPp+enj6bmpo+m5qaPp2cnD6dnJw+m5qaPp2cnD6dnJw+nZycPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPp+enj6hoKA+m5qaPp2cnD6HhoY+rawsPrm4uD2BgAA8AAAAAIGAgDsAAAAAAAAAAIGAADyBgIA7gYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAgYAAPIGAgDuBgAA8gYAAPAAAAACBgAA8AAAAAIGAgDuBgIA7gYCAO4GAADyBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAAAAAAAAAAAAAIGAgDuBgAA8AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADwAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAACBgAA8gYAAPAAAAACBgIA7gYCAO4GAgDsAAAAAAAAAAMHAQDyBgAA9ubi4PcHAQD6DgoI+o6KiPqmoqD6fnp4+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPp+enj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+oaCgPquqqj6joqI+gYCAPr28PD6xsLA9oaCgPIGAADyBgAA8gYAAPAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7gYAAPIGAADwAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAACBgAA8gYAAPAAAAACBgIA7gYCAO4GAgDuBgAA8AAAAAIGAADyBgAA8AAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAgYAAPIGAADyBgIA7AAAAAAAAAACBgIA7gYCAOwAAAACBgAA8gYCAO4GAgDuBgIA7gYCAO4GAADyBgIA7gYCAO+Hg4Dy5uLg9sbAwPoOCgj6VlJQ+o6KiPqWkpD6fnp4+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+oaCgPqmoqD6joqI+lZSUPoOCgj6trCw+ubi4PaGgoDyBgAA8gYAAPAAAAAAAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDuBgAA8gYCAO4GAgDsAAAAAgYCAO4GAADyBgIA7gYAAPIGAgDsAAAAAgYCAOwAAAACBgIA7AAAAAIGAgDuBgAA8gYAAPIGAgDuBgIA7AAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDsAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAAAAAAAAgYAAPLm4uD2xsDA+gYCAPp+enj6dnJw+n56ePp+enj6bmpo+nZycPp2cnD6dnJw+m5qaPp2cnD6dnJw+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp+enj6dnJw+n56ePp+enj6BgIA+rawsPrm4uD2BgAA8gYCAOwAAAACBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgAA8gYAAPIGAgDuBgIA7gYCAO4GAgDuBgIA7gYCAO8HAQDyBgAA8gYCAO4GAgDuBgIA7gYCAO4GAgDuBgIA7AAAAAAAAAACBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7AAAAAIGAADyhoCA9wcDAPb28PD6FhIQ+n56ePq2srD6npqY+nZycPpuamj6bmpo+n56ePp2cnD6bmpo+m5qaPp2cnD6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPp2cnD6bmpo+m5qaPpuamj6dnJw+paSkPquqqj6fnp4+g4KCPr28PD6xsLA9oaAgPcHAQDyBgIA7AAAAAAAAAACBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDuBgAA8gYCAO4GAgDuBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgIA7gYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYAAPIGAADwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAAAAAAAAAAAAAAAAAMHAQDyBgAA8AAAAAAAAAAAAAAAAgYCAOwAAAAAAAAAAgYAAPLGwMD3Z2Ng9rawsPoOCgj6VlJQ+n56ePqWkpD6joqI+nZycPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+oaCgPqempj6fnp4+lZSUPoOCgj6trCw+4eDgPZGQED0AAAAAgYAAPIGAADwAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAADBwEA8gYAAPAAAAACBgIA7gYCAO4GAADwAAAAAAAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADwAAAAAgYAAPAAAAACBgIA7gYCAOwAAAACBgIA7gYAAPAAAAACBgIA7AAAAAIGAgDuBgIA7AAAAAIGAADyBgAA8gYCAO4GAgDsAAAAAgYAAPAAAAACBgIA8sbAwPYmICD7V1FQ+iYiIPqOioj6joqI+nZycPp2cnD6dnJw+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPp2cnD6dnJw+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+n56ePp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPp+enj6fnp4+o6KiPqOioj6HhoY+1dRUPoWEBD6hoCA9gYCAPIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDuBgAA8gYCAOwAAAACBgIA7gYCAO4GAADwAAAAAAAAAAIGAADyBgAA8AAAAAIGAgDsAAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDuBgIA7AAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7gYCAO4GAgDsAAAAAAAAAAKGgoDypqKg9jYwMPt3cXD6NjIw+n56ePqmoqD6lpKQ+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+paSkPqmoqD6dnJw+jYyMPt3cXD6NjAw+mZiYPYGAgDyBgIA7gYCAOwAAAACBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDuBgIA7gYCAO4GAgDsAAAAAAAAAAIGAADyBgIA7AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgIA7gYCAO4GAgDsAAAAAAAAAAIGAgDsAAAAAwcBAPKmoqD3BwEA+6ehoPo+Ojj6dnJw+m5qaPp+enj6fnp4+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPp2cnD6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+n56ePp+enj6bmpo+nZycPpGQkD7h4GA+rawsPpGQkD3BwEA8gYCAOwAAAAAAAAAAgYCAO4GAgDsAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgAA8gYCAO4GAgDsAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAIGAgDsAAAAAAAAAAIGAADyBgAA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADwAAAAAgYCAOwAAAACBgIA7gYCAO4GAgDuRkBA9ycjIPc3MTD6Pjo4+n56ePqmoqD6npqY+n56ePp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6dnJw+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp+enj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6joqI+q6qqPqmoqD6bmpo+h4aGPr28PD6xsLA9gYAAPYGAADyBgAA8AAAAAIGAgDsAAAAAAAAAAAAAAAAAAAAAgYAAPIGAADwAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAACBgAA8gYAAPAAAAACBgIA7AAAAAIGAgDuBgIA7AAAAAIGAgDuBgAA8AAAAAAAAAAAAAAAAgYCAO4GAgDsAAAAAgYCAO4GAADyBgIA7AAAAAAAAAADBwEA8kZAQPcHAQD3p6Og9wcBAPoOCgj6dnJw+o6KiPqempj6joqI+n56ePp2cnD6dnJw+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+nZycPpuamj6hoKA+p6amPqempj6hoKA+l5aWPvn4eD7BwEA++fj4PeHgYD2BgAA9AAAAAAAAAAAAAAAAgYAAPIGAgDsAAAAAgYCAO4GAADwAAAAAAAAAAAAAAACBgIA7AAAAAAAAAACBgAA8gYAAPAAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAAAAAACBgIA7gYCAO4GAgDsAAAAAgYCAO4GAgDsAAAAAAAAAAIGAgDuBgIA7gYAAPMHAQDyhoKA9jYwMPrW0ND75+Hg+jYyMPpWUlD6fnp4+nZycPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+nZycPp2cnD6dnJw+nZycPpmYmD6RkJA+iYiIPsXERD75+Pg9oaAgPYGAgDsAAAAAgYAAPAAAAAAAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAACBgIA7AAAAAAAAAAAAAAAAgYCAO4GAgDuBgIA7AAAAAAAAAACBgIA7gYCAOwAAAAAAAAAAAAAAAIGAgDsAAAAAAAAAAIGAgDuBgIA7gYAAPIGAADyhoKA84eBgPdHQ0D2xsDA+7exsPo2MjD6joqI+qaioPqWkpD6fnp4+nZycPpuamj6ZmJg+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+mZiYPpuamj6dnJw+n56ePqempj6vrq4+r66uPo+Ojj7h4GA+lZQUPpGQkD2xsDA9gYCAPIGAADwAAAAAAAAAAIGAgDsAAAAAgYCAO4GAgDsAAAAAgYCAO4GAgDsAAAAAgYCAOwAAAACBgIA7gYAAPIGAADwAAAAAgYCAOwAAAACBgIA7AAAAAAAAAACBgAA8gYAAPAAAAACBgIA7kZAQPYGAgD2xsLA9mZgYPtHQUD6DgoI+jYyMPpWUlD6fnp4+o6KiPp+enj6dnJw+n56ePp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPp2cnD6dnJw+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+n56ePpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+n56ePqWkpD6lpKQ+paSkPpeWlj6Pjo4+8fBwPrGwMD6NjAw+kZCQPYGAAD2BgAA8AAAAAAAAAAAAAAAAAAAAAIGAADyBgAA8gYCAO4GAgDsAAAAAgYAAPAAAAAAAAAAAgYCAO4GAADwAAAAAgYCAOwAAAAAAAAAAAAAAAAAAAAAAAAAAgYAAPKGgoDzx8HA9iYgIPrm4OD7t7Gw+k5KSPpuamj6joqI+o6KiPp+enj6dnJw+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPp+enj6npqY+o6KiPpWUlD6HhoY+ychIPomICD65uLg9wcDAPMHAQDyBgIA7AAAAAAAAAACBgIA7AAAAAIGAgDsAAAAAgYCAO4GAgDsAAAAAAAAAAIGAgDuBgIA7gYCAOwAAAAAAAAAAwcBAPIGAgDzBwMA8wcBAPcHAwD2hoCA+3dxcPoGAgD6RkJA+paSkPqmoqD6rqqo+p6amPqOioj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPqGgoD6pqKg+r66uPqempj6dnJw+g4KCPt3cXD7BwEA+jYwMPrm4uD3R0FA9wcDAPIGAgDzBwEA8AAAAAAAAAAAAAAAAAAAAAAAAAACBgIA7AAAAAAAAAAAAAAAAgYCAO4GAgDuhoKA8wcBAPbm4uD3h4OA9mZgYPtHQUD75+Hg+j46OPpWUlD6XlpY+nZycPp2cnD6fnp4+n56ePp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp+enj6fnp4+oaCgPp2cnD6bmpo+k5KSPo+Ojj6Lioo+8fBwPtHQUD6hoCA+4eDgPbGwsD3R0FA9gYCAPIGAgDsAAAAAAAAAAIGAgDuBgIA7AAAAAMHAQDzh4OA84eBgPcnIyD3x8PA9nZwcPtHQUD7t7Gw+j46OPqGgoD6lpKQ+q6qqPqempj6hoKA+nZycPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6fnp4+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPp2cnD6fnp4+o6KiPqmoqD6pqKg+q6qqPqOioj6Pjo4+7exsPtHQUD6dnBw+6ejoPcHAwD3x8HA9gYAAPcHAQDyBgIA70dBQPamoqD3p6Og9paQkPs3MTD7Z2Fg+6ehoPoOCgj6NjIw+m5qaPqOioj6npqY+p6amPqWkpD6hoKA+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPp2cnD6fnp4+paSkPqWkpD6pqKg+q6qqPqempj6bmpo+jYyMPoWEhD7p6Gg+1dRUPs3MTD6lpCQ+2djYPZGQkD3BwEA9vbw8PtHQUD7x8HA+iYiIPpeWlj6XlpY+lZSUPpeWlj6ZmJg+m5qaPpuamj6dnJw+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+nZycPp2cnD6bmpo+mZiYPpeWlj6XlpY+mZiYPpmYmD6FhIQ+4eBgPsHAQD6pqCg+/fx8Po2MjD6dnJw+sbCwPrm4uD63trY+sbCwPquqqj6npqY+o6KiPp+enj6fnp4+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp+enj6joqI+p6amPquqqj6xsLA+ubi4Prm4uD6xsLA+nZycPomIiD719HQ++fh4PouKij6bmpo+sbCwPrm4uD63trY+sbCwPquqqj6pqKg+o6KiPp+enj6dnJw+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+nZycPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6dnJw+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6dnJw+nZycPp+enj6joqI+p6amPq2srD6zsrI+t7a2Prm4uD6xsLA+nZycPo2MjD79/Hw+qagoPsXERD7d3Fw+h4aGPpmYmD6ZmJg+lZSUPpeWlj6ZmJg+nZycPpuamj6dnJw+nZycPp2cnD6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6dnJw+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6dnJw+nZycPp2cnD6dnJw+nZycPpuamj6bmpo+mZiYPpmYmD6XlpY+l5aWPpeWlj6HhoY+7exsPtXUVD69vDw+wcBAPZGQkD3Z2Ng9paQkPs3MTD7Z2Fg+6ehoPoWEhD6NjIw+m5qaPqWkpD6pqKg+qaioPqWkpD6joqI+n56ePp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+nZycPpuamj6bmpo+m5qaPpuamj6dnJw+oaCgPqOioj6pqKg+p6amPqOioj6bmpo+jYyMPoOCgj7p6Gg+1dRUPsnISD6lpCQ+6ejoPaGgoD3h4GA9gYCAO8HAQDzh4OA88fBwPcnIyD3p6Og9nZwcPtHQUD7t7Gw+j46OPqGgoD6pqKg+qaioPqmoqD6joqI+n56ePp2cnD6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+m5qaPpuamj6bmpo+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"
  };
  var decodedAlphaMaps = /* @__PURE__ */ new Map();
  function decodeBase64(base64) {
    if (typeof Buffer !== "undefined") {
      return Uint8Array.from(Buffer.from(base64, "base64"));
    }
    if (typeof atob !== "undefined") {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
    throw new Error("No base64 decoder available in current runtime");
  }
  function getEmbeddedAlphaMap(size) {
    const knownSize = String(size);
    if (!(knownSize in EMBEDDED_ALPHA_MAP_BASE64)) {
      return null;
    }
    if (!decodedAlphaMaps.has(knownSize)) {
      const bytes = decodeBase64(EMBEDDED_ALPHA_MAP_BASE64[knownSize]);
      const expectedLength = EMBEDDED_ALPHA_MAP_LENGTHS[knownSize];
      const view = new Float32Array(bytes.buffer, bytes.byteOffset, expectedLength);
      decodedAlphaMaps.set(knownSize, new Float32Array(view));
    }
    return new Float32Array(decodedAlphaMaps.get(knownSize));
  }

  // src/core/blendModes.js
  var ALPHA_NOISE_FLOOR = 3 / 255;
  var ALPHA_THRESHOLD = 2e-3;
  var MAX_ALPHA = 0.99;
  var LOGO_VALUE = 255;
  function removeWatermark(imageData, alphaMap, position, options = {}) {
    const { x, y, width, height } = position;
    const alphaGain = Number.isFinite(options.alphaGain) && options.alphaGain > 0 ? options.alphaGain : 1;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const imgIdx = ((y + row) * imageData.width + (x + col)) * 4;
        const alphaIdx = row * width + col;
        const rawAlpha = alphaMap[alphaIdx];
        const alphaMagnitude = Math.abs(rawAlpha);
        const logoValue = Number.isFinite(options.logoValue) ? options.logoValue : rawAlpha < 0 ? 0 : LOGO_VALUE;
        const signalAlpha = Math.max(0, alphaMagnitude - ALPHA_NOISE_FLOOR) * alphaGain;
        if (signalAlpha < ALPHA_THRESHOLD) {
          continue;
        }
        const alpha = Math.min(alphaMagnitude * alphaGain, MAX_ALPHA);
        const oneMinusAlpha = 1 - alpha;
        for (let c = 0; c < 3; c++) {
          const watermarked = imageData.data[imgIdx + c];
          const original = (watermarked - alpha * logoValue) / oneMinusAlpha;
          imageData.data[imgIdx + c] = Math.max(0, Math.min(255, Math.round(original)));
        }
      }
    }
  }

  // src/core/restorationMetrics.js
  var NEAR_BLACK_THRESHOLD = 5;
  var TEXTURE_REFERENCE_MARGIN = 1;
  var TEXTURE_STD_FLOOR_RATIO = 0.8;
  var TEXTURE_DARKNESS_VISIBILITY_HARD_REJECT_THRESHOLD = 1.5;
  var TEXTURE_DARKNESS_HARD_REJECT_PENALTY_THRESHOLD = 0.5;
  var TEXTURE_FLATNESS_HARD_REJECT_PENALTY_THRESHOLD = 0.2;
  var DEFAULT_HALO_MIN_ALPHA = 0.12;
  var DEFAULT_HALO_MAX_ALPHA = 0.35;
  var DEFAULT_HALO_OUTSIDE_ALPHA_MAX = 0.01;
  var DEFAULT_HALO_OUTER_MARGIN = 3;
  var DIFF_NEGATIVE_THRESHOLD = 1 / 255;
  var DIFF_CLIP_ORIGINAL_THRESHOLD = 5;
  var DIFF_CLIP_CANDIDATE_THRESHOLD = 0;
  var RECOMPOSE_MAX_ALPHA = 0.99;
  var DIFF_DARK_HALO_VISUAL_WEIGHT = 4e-3;
  var DIFF_NEW_CLIP_VISUAL_WEIGHT = 0.5;
  var RESIDUAL_VISIBILITY_CORE_MIN_ALPHA = 0.18;
  var RESIDUAL_VISIBILITY_CORE_MAX_ALPHA = 0.35;
  var RESIDUAL_VISIBILITY_OUTSIDE_ALPHA_MAX = 0.012;
  var RESIDUAL_VISIBILITY_OUTER_MARGIN = 4;
  var RESIDUAL_VISIBILITY_POSITIVE_HALO_LUM_THRESHOLD = 6;
  var RESIDUAL_VISIBILITY_GRADIENT_THRESHOLD = 0.22;
  var RESIDUAL_VISIBILITY_SPATIAL_THRESHOLD = 0.18;
  var FLAT_CLIPPED_METRIC_RISK_NEAR_BLACK_RATIO = 0.92;
  var FLAT_CLIPPED_METRIC_RISK_NEWLY_CLIPPED_RATIO = 0.18;
  var FLAT_CLIPPED_METRIC_RISK_MAX_POSITIVE_HALO_LUM = 2;
  var FLAT_CLIPPED_METRIC_RISK_MIN_NEGATIVE_SPATIAL = 0.18;
  var POSITIVE_SPATIAL_BACKGROUND_COLLISION_MIN_SPATIAL = 0.14;
  var POSITIVE_SPATIAL_BACKGROUND_COLLISION_MAX_GRADIENT = 0.12;
  var POSITIVE_SPATIAL_BACKGROUND_COLLISION_MAX_POSITIVE_HALO_LUM = 32;
  var POSITIVE_SPATIAL_BACKGROUND_COLLISION_MAX_ARTIFACT_COST = 0.12;
  var WEAK_HALO_BACKGROUND_COLLISION_MAX_ABS_SPATIAL = 0.14;
  var WEAK_HALO_BACKGROUND_COLLISION_MAX_GRADIENT = 0.12;
  var WEAK_HALO_BACKGROUND_COLLISION_MAX_POSITIVE_HALO_LUM = 16;
  var WEAK_HALO_BACKGROUND_COLLISION_MAX_ARTIFACT_COST = 0.12;
  var WEAK_HALO_BACKGROUND_COLLISION_MAX_NEAR_BLACK_RATIO = 0.25;
  var WEAK_HALO_BACKGROUND_COLLISION_MAX_NEWLY_CLIPPED_RATIO = 0.02;
  var STRUCTURED_EDGE_BACKGROUND_COLLISION_MIN_GRADIENT = 0.2;
  var STRUCTURED_EDGE_BACKGROUND_COLLISION_MIN_ARTIFACT_COST = 0.2;
  var STRUCTURED_EDGE_BACKGROUND_COLLISION_MAX_NEAR_BLACK_RATIO = 0.1;
  var STRUCTURED_EDGE_BACKGROUND_COLLISION_MAX_NEWLY_CLIPPED_RATIO = 0.01;
  function meanAndVariance2(values) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
    }
    const mean = values.length > 0 ? sum / values.length : 0;
    let sq = 0;
    for (let i = 0; i < values.length; i++) {
      const delta = values[i] - mean;
      sq += delta * delta;
    }
    return {
      mean,
      variance: values.length > 0 ? sq / values.length : 0
    };
  }
  function normalizedCorrelation(a, b) {
    if (a.length !== b.length || a.length === 0) return 0;
    const statsA = meanAndVariance2(a);
    const statsB = meanAndVariance2(b);
    const den = Math.sqrt(statsA.variance * statsB.variance) * a.length;
    if (den < 1e-8) return 0;
    let num = 0;
    for (let i = 0; i < a.length; i++) {
      num += (a[i] - statsA.mean) * (b[i] - statsB.mean);
    }
    return num / den;
  }
  function sobelMagnitude2(values, width, height) {
    const out = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx = -values[i - width - 1] - 2 * values[i - 1] - values[i + width - 1] + values[i - width + 1] + 2 * values[i + 1] + values[i + width + 1];
        const gy = -values[i - width - 1] - 2 * values[i - width] - values[i - width + 1] + values[i + width - 1] + 2 * values[i + width] + values[i + width + 1];
        out[i] = Math.sqrt(gx * gx + gy * gy);
      }
    }
    return out;
  }
  function cloneImageData(imageData) {
    if (typeof ImageData !== "undefined" && imageData instanceof ImageData) {
      return new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      );
    }
    return {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data)
    };
  }
  function calculateNearBlackRatio(imageData, position) {
    let nearBlack = 0;
    let total = 0;
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const idx = ((position.y + row) * imageData.width + (position.x + col)) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        if (r <= NEAR_BLACK_THRESHOLD && g <= NEAR_BLACK_THRESHOLD && b <= NEAR_BLACK_THRESHOLD) {
          nearBlack++;
        }
        total++;
      }
    }
    return total > 0 ? nearBlack / total : 0;
  }
  function calculateRegionTextureStats(imageData, region) {
    let sum = 0;
    let sq = 0;
    let total = 0;
    for (let row = 0; row < region.height; row++) {
      for (let col = 0; col < region.width; col++) {
        const idx = ((region.y + row) * imageData.width + (region.x + col)) * 4;
        const lum = 0.2126 * imageData.data[idx] + 0.7152 * imageData.data[idx + 1] + 0.0722 * imageData.data[idx + 2];
        sum += lum;
        sq += lum * lum;
        total++;
      }
    }
    const meanLum = total > 0 ? sum / total : 0;
    const variance = total > 0 ? Math.max(0, sq / total - meanLum * meanLum) : 0;
    return {
      meanLum,
      stdLum: Math.sqrt(variance)
    };
  }
  function getRegionTextureStats(imageData, region) {
    return calculateRegionTextureStats(imageData, region);
  }
  function assessAlphaBandHalo({
    imageData,
    position,
    alphaMap,
    minAlpha = DEFAULT_HALO_MIN_ALPHA,
    maxAlpha = DEFAULT_HALO_MAX_ALPHA,
    outsideAlphaMax = DEFAULT_HALO_OUTSIDE_ALPHA_MAX,
    outerMargin = DEFAULT_HALO_OUTER_MARGIN
  }) {
    let bandSum = 0;
    let bandSq = 0;
    let bandCount = 0;
    let outerSum = 0;
    let outerSq = 0;
    let outerCount = 0;
    for (let row = -outerMargin; row < position.height + outerMargin; row++) {
      for (let col = -outerMargin; col < position.width + outerMargin; col++) {
        const pixelX = position.x + col;
        const pixelY = position.y + row;
        if (pixelX < 0 || pixelY < 0 || pixelX >= imageData.width || pixelY >= imageData.height) {
          continue;
        }
        const pixelIndex = (pixelY * imageData.width + pixelX) * 4;
        const luminance = 0.2126 * imageData.data[pixelIndex] + 0.7152 * imageData.data[pixelIndex + 1] + 0.0722 * imageData.data[pixelIndex + 2];
        const insideRegion = row >= 0 && col >= 0 && row < position.height && col < position.width;
        const alpha = insideRegion ? alphaMap[row * position.width + col] : 0;
        if (insideRegion && alpha >= minAlpha && alpha <= maxAlpha) {
          bandSum += luminance;
          bandSq += luminance * luminance;
          bandCount++;
          continue;
        }
        if (!insideRegion || alpha <= outsideAlphaMax) {
          outerSum += luminance;
          outerSq += luminance * luminance;
          outerCount++;
        }
      }
    }
    const bandMeanLum = bandCount > 0 ? bandSum / bandCount : 0;
    const outerMeanLum = outerCount > 0 ? outerSum / outerCount : 0;
    const bandStdLum = bandCount > 0 ? Math.sqrt(Math.max(0, bandSq / bandCount - bandMeanLum * bandMeanLum)) : 0;
    const outerStdLum = outerCount > 0 ? Math.sqrt(Math.max(0, outerSq / outerCount - outerMeanLum * outerMeanLum)) : 0;
    const deltaLum = bandMeanLum - outerMeanLum;
    const visibility = deltaLum / Math.max(1, outerStdLum);
    return {
      bandCount,
      outerCount,
      bandMeanLum,
      outerMeanLum,
      bandStdLum,
      outerStdLum,
      deltaLum,
      positiveDeltaLum: Math.max(0, deltaLum),
      visibility
    };
  }
  function assessRemovalDiffArtifacts({
    originalImageData,
    candidateImageData,
    alphaMap,
    position,
    alphaGain = 1
  }) {
    if (!originalImageData || !candidateImageData || !alphaMap || !position) {
      return null;
    }
    const total = position.width * position.height;
    if (total <= 0) return null;
    const positiveDiff = new Float32Array(total);
    const signedDiff = new Float32Array(total);
    const candidateLum = new Float32Array(total);
    const gainedAlpha = new Float32Array(total);
    let negativeDiffCount = 0;
    let newlyClippedCount = 0;
    let recomposeError = 0;
    let weightedRecomposeError = 0;
    let recomposeCount = 0;
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const pixelIndex = ((position.y + row) * originalImageData.width + position.x + col) * 4;
        const beforeR = originalImageData.data[pixelIndex];
        const beforeG = originalImageData.data[pixelIndex + 1];
        const beforeB = originalImageData.data[pixelIndex + 2];
        const afterR = candidateImageData.data[pixelIndex];
        const afterG = candidateImageData.data[pixelIndex + 1];
        const afterB = candidateImageData.data[pixelIndex + 2];
        const beforeLum = 0.2126 * beforeR + 0.7152 * beforeG + 0.0722 * beforeB;
        const afterLum = 0.2126 * afterR + 0.7152 * afterG + 0.0722 * afterB;
        const diff = (beforeLum - afterLum) / 255;
        const alpha = Math.min(RECOMPOSE_MAX_ALPHA, Math.max(0, alphaMap[localIndex] * alphaGain));
        positiveDiff[localIndex] = Math.max(0, diff);
        signedDiff[localIndex] = diff;
        candidateLum[localIndex] = afterLum / 255;
        gainedAlpha[localIndex] = alpha;
        if (diff < -DIFF_NEGATIVE_THRESHOLD) {
          negativeDiffCount++;
        }
        if (afterR <= DIFF_CLIP_CANDIDATE_THRESHOLD && beforeR > DIFF_CLIP_ORIGINAL_THRESHOLD || afterG <= DIFF_CLIP_CANDIDATE_THRESHOLD && beforeG > DIFF_CLIP_ORIGINAL_THRESHOLD || afterB <= DIFF_CLIP_CANDIDATE_THRESHOLD && beforeB > DIFF_CLIP_ORIGINAL_THRESHOLD) {
          newlyClippedCount++;
        }
        for (const [before, after] of [[beforeR, afterR], [beforeG, afterG], [beforeB, afterB]]) {
          const recomposed = after * (1 - alpha) + 255 * alpha;
          const error = Math.abs(recomposed - before) / 255;
          recomposeError += error;
          weightedRecomposeError += error * Math.max(0.02, alpha);
          recomposeCount++;
        }
      }
    }
    const alphaGradient = sobelMagnitude2(gainedAlpha, position.width, position.height);
    const diffGradient = sobelMagnitude2(positiveDiff, position.width, position.height);
    const candidateGradient = sobelMagnitude2(candidateLum, position.width, position.height);
    const scores = scoreRegion(candidateImageData, alphaMap, position);
    const halo = assessAlphaBandHalo({
      imageData: candidateImageData,
      position,
      alphaMap
    });
    const newlyClippedRatio = newlyClippedCount / total;
    const visualArtifactCost = Math.abs(scores.spatialScore) * 0.25 + Math.max(0, scores.gradientScore) + Math.max(0, -halo.deltaLum) * DIFF_DARK_HALO_VISUAL_WEIGHT + newlyClippedRatio * DIFF_NEW_CLIP_VISUAL_WEIGHT;
    return {
      spatialScore: scores.spatialScore,
      gradientScore: scores.gradientScore,
      recomposeError: recomposeError / Math.max(1, recomposeCount),
      weightedRecomposeError: weightedRecomposeError / Math.max(1, recomposeCount),
      diffTemplateCorrelation: normalizedCorrelation(positiveDiff, gainedAlpha),
      signedDiffTemplateCorrelation: normalizedCorrelation(signedDiff, gainedAlpha),
      diffGradientCorrelation: normalizedCorrelation(diffGradient, alphaGradient),
      candidateGradientCorrelation: normalizedCorrelation(candidateGradient, alphaGradient),
      negativeDiffRatio: negativeDiffCount / total,
      newlyClippedRatio,
      halo,
      visualArtifactCost
    };
  }
  function assessWatermarkResidualVisibility({
    imageData,
    position,
    alphaMap
  }) {
    if (!imageData || !position || !alphaMap) return null;
    const scores = scoreRegion(imageData, alphaMap, position);
    const halo = assessAlphaBandHalo({
      imageData,
      position,
      alphaMap,
      minAlpha: RESIDUAL_VISIBILITY_CORE_MIN_ALPHA,
      maxAlpha: RESIDUAL_VISIBILITY_CORE_MAX_ALPHA,
      outsideAlphaMax: RESIDUAL_VISIBILITY_OUTSIDE_ALPHA_MAX,
      outerMargin: RESIDUAL_VISIBILITY_OUTER_MARGIN
    });
    const positiveHaloLum = Math.max(0, halo.deltaLum);
    const gradientResidual = Math.max(0, scores.gradientScore);
    const spatialResidual = Math.abs(scores.spatialScore);
    const visiblePositiveHalo = positiveHaloLum >= RESIDUAL_VISIBILITY_POSITIVE_HALO_LUM_THRESHOLD;
    const visibleGradientResidual = gradientResidual >= RESIDUAL_VISIBILITY_GRADIENT_THRESHOLD;
    const visibleSpatialResidual = spatialResidual >= RESIDUAL_VISIBILITY_SPATIAL_THRESHOLD;
    return {
      visible: visiblePositiveHalo || visibleGradientResidual || visibleSpatialResidual,
      positiveHaloLum,
      haloVisibility: halo.visibility,
      spatialResidual,
      gradientResidual,
      visiblePositiveHalo,
      visibleGradientResidual,
      visibleSpatialResidual,
      halo
    };
  }
  function assessCalibratedWatermarkResidualVisibility({
    imageData,
    originalImageData = null,
    position,
    alphaMap,
    alphaGain = 1
  }) {
    const visibility = assessWatermarkResidualVisibility({
      imageData,
      position,
      alphaMap
    });
    if (!visibility) return null;
    const scores = scoreRegion(imageData, alphaMap, position);
    const nearBlackRatio = calculateNearBlackRatio(imageData, position);
    const artifacts = originalImageData ? assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: imageData,
      alphaMap,
      position,
      alphaGain
    }) : null;
    const newlyClippedRatio = artifacts?.newlyClippedRatio ?? 0;
    const metricRisk = classifyCalibratedResidualMetricRisk({
      visibility,
      spatialScore: scores.spatialScore,
      gradientScore: scores.gradientScore,
      nearBlackRatio,
      newlyClippedRatio,
      visualArtifactCost: artifacts?.visualArtifactCost ?? null,
      hasOriginalImageData: Boolean(originalImageData)
    });
    return {
      ...visibility,
      rawVisible: visibility.visible,
      visible: visibility.visible && !metricRisk,
      calibratedVisible: visibility.visible && !metricRisk,
      metricRisk,
      nearBlackRatio,
      newlyClippedRatio,
      rawSpatialScore: scores.spatialScore,
      rawGradientScore: scores.gradientScore
    };
  }
  function classifyCalibratedResidualMetricRisk({
    visibility,
    spatialScore,
    gradientScore,
    nearBlackRatio = 0,
    newlyClippedRatio = 0,
    visualArtifactCost = null,
    hasOriginalImageData = false
  }) {
    if (visibility?.visible !== true) return null;
    if (visibility.visibleSpatialResidual === true && visibility.visiblePositiveHalo !== true && spatialScore <= -FLAT_CLIPPED_METRIC_RISK_MIN_NEGATIVE_SPATIAL && visibility.positiveHaloLum <= FLAT_CLIPPED_METRIC_RISK_MAX_POSITIVE_HALO_LUM && nearBlackRatio >= FLAT_CLIPPED_METRIC_RISK_NEAR_BLACK_RATIO && (!hasOriginalImageData || newlyClippedRatio >= FLAT_CLIPPED_METRIC_RISK_NEWLY_CLIPPED_RATIO)) {
      return "flat-clipped-low-texture-spatial-correlation";
    }
    if (visibility.visibleGradientResidual !== true && spatialScore >= POSITIVE_SPATIAL_BACKGROUND_COLLISION_MIN_SPATIAL && gradientScore < POSITIVE_SPATIAL_BACKGROUND_COLLISION_MAX_GRADIENT && visibility.positiveHaloLum <= POSITIVE_SPATIAL_BACKGROUND_COLLISION_MAX_POSITIVE_HALO_LUM && visualArtifactCost !== null && visualArtifactCost <= POSITIVE_SPATIAL_BACKGROUND_COLLISION_MAX_ARTIFACT_COST) {
      return visibility.visiblePositiveHalo === true ? "positive-halo-background-collision" : "positive-spatial-background-collision";
    }
    if (visibility.visiblePositiveHalo === true && visibility.visibleSpatialResidual !== true && visibility.visibleGradientResidual !== true && Math.abs(spatialScore) < WEAK_HALO_BACKGROUND_COLLISION_MAX_ABS_SPATIAL && gradientScore < WEAK_HALO_BACKGROUND_COLLISION_MAX_GRADIENT && visibility.positiveHaloLum <= WEAK_HALO_BACKGROUND_COLLISION_MAX_POSITIVE_HALO_LUM && nearBlackRatio < WEAK_HALO_BACKGROUND_COLLISION_MAX_NEAR_BLACK_RATIO && newlyClippedRatio <= WEAK_HALO_BACKGROUND_COLLISION_MAX_NEWLY_CLIPPED_RATIO && visualArtifactCost !== null && visualArtifactCost <= WEAK_HALO_BACKGROUND_COLLISION_MAX_ARTIFACT_COST) {
      return "weak-halo-background-collision";
    }
    if (visibility.visiblePositiveHalo === true && visibility.visibleGradientResidual !== true && gradientScore >= STRUCTURED_EDGE_BACKGROUND_COLLISION_MIN_GRADIENT && nearBlackRatio < STRUCTURED_EDGE_BACKGROUND_COLLISION_MAX_NEAR_BLACK_RATIO && newlyClippedRatio <= STRUCTURED_EDGE_BACKGROUND_COLLISION_MAX_NEWLY_CLIPPED_RATIO && visualArtifactCost !== null && visualArtifactCost >= STRUCTURED_EDGE_BACKGROUND_COLLISION_MIN_ARTIFACT_COST) {
      return "structured-edge-background-collision";
    }
    return null;
  }
  function getReferenceRegion(position, imageData) {
    const referenceY = position.y - position.height;
    if (referenceY < 0) return null;
    return {
      x: position.x,
      y: referenceY,
      width: position.width,
      height: position.height
    };
  }
  function assessReferenceTextureAlignment({
    originalImageData,
    referenceImageData,
    candidateImageData,
    position
  }) {
    const candidateTextureStats = candidateImageData ? calculateRegionTextureStats(candidateImageData, position) : null;
    return assessReferenceTextureAlignmentFromStats({
      originalImageData,
      referenceImageData,
      candidateTextureStats,
      position
    });
  }
  function assessReferenceTextureAlignmentFromStats({
    originalImageData,
    referenceImageData,
    candidateTextureStats,
    position
  }) {
    const resolvedReferenceImageData = referenceImageData ?? originalImageData;
    const referenceRegion = resolvedReferenceImageData ? getReferenceRegion(position, resolvedReferenceImageData) : null;
    const referenceTextureStats = referenceRegion ? calculateRegionTextureStats(resolvedReferenceImageData, referenceRegion) : null;
    const darknessPenalty = referenceTextureStats && candidateTextureStats ? Math.max(0, referenceTextureStats.meanLum - candidateTextureStats.meanLum - TEXTURE_REFERENCE_MARGIN) / Math.max(1, referenceTextureStats.meanLum) : 0;
    const flatnessPenalty = referenceTextureStats && candidateTextureStats ? Math.max(0, referenceTextureStats.stdLum * TEXTURE_STD_FLOOR_RATIO - candidateTextureStats.stdLum) / Math.max(1, referenceTextureStats.stdLum) : 0;
    const darknessVisibility = referenceTextureStats && candidateTextureStats ? Math.max(0, referenceTextureStats.meanLum - candidateTextureStats.meanLum - TEXTURE_REFERENCE_MARGIN) / Math.max(1, referenceTextureStats.stdLum) : 0;
    const tooDark = darknessPenalty > 0;
    const tooFlat = flatnessPenalty > 0;
    const visibleDarkHole = tooDark && darknessVisibility >= TEXTURE_DARKNESS_VISIBILITY_HARD_REJECT_THRESHOLD;
    const strongDarkFlatCollapse = tooDark && tooFlat && darknessPenalty >= TEXTURE_DARKNESS_HARD_REJECT_PENALTY_THRESHOLD && flatnessPenalty >= TEXTURE_FLATNESS_HARD_REJECT_PENALTY_THRESHOLD;
    return {
      referenceTextureStats,
      candidateTextureStats,
      darknessPenalty,
      flatnessPenalty,
      darknessVisibility,
      texturePenalty: darknessPenalty * 2 + flatnessPenalty * 2,
      tooDark,
      tooFlat,
      visibleDarkHole,
      hardReject: strongDarkFlatCollapse || visibleDarkHole
    };
  }
  function scoreRegion(imageData, alphaMap, position) {
    return {
      spatialScore: computeRegionSpatialCorrelation({
        imageData,
        alphaMap,
        region: {
          x: position.x,
          y: position.y,
          size: position.width
        }
      }),
      gradientScore: computeRegionGradientCorrelation({
        imageData,
        alphaMap,
        region: {
          x: position.x,
          y: position.y,
          size: position.width
        }
      })
    };
  }

  // src/core/multiPassRemoval.js
  var DEFAULT_MAX_PASSES = 4;
  var DEFAULT_RESIDUAL_THRESHOLD = 0.25;
  var MAX_NEAR_BLACK_RATIO_INCREASE = 0.05;
  function removeRepeatedWatermarkLayers(imageDataOrOptions, alphaMapArg, positionArg, optionsArg = {}) {
    const isObjectCall = imageDataOrOptions && typeof imageDataOrOptions === "object" && "imageData" in imageDataOrOptions && alphaMapArg === void 0;
    const imageData = isObjectCall ? imageDataOrOptions.imageData : imageDataOrOptions;
    const alphaMap = isObjectCall ? imageDataOrOptions.alphaMap : alphaMapArg;
    const position = isObjectCall ? imageDataOrOptions.position : positionArg;
    const options = isObjectCall ? imageDataOrOptions : optionsArg;
    const maxPasses = Math.max(1, options.maxPasses ?? DEFAULT_MAX_PASSES);
    const residualThreshold = options.residualThreshold ?? DEFAULT_RESIDUAL_THRESHOLD;
    const startingPassIndex = Math.max(0, options.startingPassIndex ?? 0);
    const alphaGain = Number.isFinite(options.alphaGain) && options.alphaGain > 0 ? options.alphaGain : 1;
    let currentImageData = cloneImageData(imageData);
    const referenceImageData = currentImageData;
    const baseNearBlackRatio = calculateNearBlackRatio(currentImageData, position);
    const maxNearBlackRatio = Math.min(1, baseNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE);
    const passes = [];
    let stopReason = "max-passes";
    let appliedPassCount = startingPassIndex;
    let attemptedPassCount = startingPassIndex;
    for (let passIndex = 0; passIndex < maxPasses; passIndex++) {
      attemptedPassCount = startingPassIndex + passIndex + 1;
      const before = scoreRegion(currentImageData, alphaMap, position);
      const candidate = cloneImageData(currentImageData);
      removeWatermark(candidate, alphaMap, position, { alphaGain });
      const after = scoreRegion(candidate, alphaMap, position);
      const nearBlackRatio = calculateNearBlackRatio(candidate, position);
      const improvement = Math.abs(before.spatialScore) - Math.abs(after.spatialScore);
      const gradientDelta = after.gradientScore - before.gradientScore;
      const textureAssessment = assessReferenceTextureAlignment({
        referenceImageData,
        candidateImageData: candidate,
        position
      });
      if (nearBlackRatio > maxNearBlackRatio) {
        stopReason = "safety-near-black";
        break;
      }
      if (textureAssessment.hardReject) {
        stopReason = "safety-texture-collapse";
        break;
      }
      currentImageData = candidate;
      appliedPassCount = startingPassIndex + passIndex + 1;
      passes.push({
        index: appliedPassCount,
        beforeSpatialScore: before.spatialScore,
        beforeGradientScore: before.gradientScore,
        afterSpatialScore: after.spatialScore,
        afterGradientScore: after.gradientScore,
        improvement,
        gradientDelta,
        nearBlackRatio
      });
      if (Math.abs(after.spatialScore) <= residualThreshold) {
        stopReason = "residual-low";
        break;
      }
    }
    return {
      imageData: currentImageData,
      passCount: appliedPassCount,
      attemptedPassCount,
      stopReason,
      passes
    };
  }

  // src/core/alphaGradientMask.js
  var EPSILON2 = 1e-8;
  function clamp3(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function gaussianKernel1D(sigma) {
    if (!Number.isFinite(sigma) || sigma <= 0) return null;
    const radius = Math.max(1, Math.ceil(sigma * 3));
    const kernel = new Float32Array(radius * 2 + 1);
    let sum = 0;
    for (let i = -radius; i <= radius; i++) {
      const value = Math.exp(-(i * i) / (2 * sigma * sigma));
      kernel[i + radius] = value;
      sum += value;
    }
    if (sum <= EPSILON2) return null;
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= sum;
    }
    return { kernel, radius };
  }
  function blurHorizontal(values, width, height, kernelInfo) {
    const out = new Float32Array(values.length);
    const { kernel, radius } = kernelInfo;
    for (let y = 0; y < height; y++) {
      const rowBase = y * width;
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = clamp3(x + k, 0, width - 1);
          sum += values[rowBase + sx] * kernel[k + radius];
        }
        out[rowBase + x] = sum;
      }
    }
    return out;
  }
  function blurVertical(values, width, height, kernelInfo) {
    const out = new Float32Array(values.length);
    const { kernel, radius } = kernelInfo;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const sy = clamp3(y + k, 0, height - 1);
          sum += values[sy * width + x] * kernel[k + radius];
        }
        out[y * width + x] = sum;
      }
    }
    return out;
  }
  function gaussianBlur(values, width, height, sigma) {
    const kernelInfo = gaussianKernel1D(sigma);
    if (!kernelInfo) return new Float32Array(values);
    return blurVertical(
      blurHorizontal(values, width, height, kernelInfo),
      width,
      height,
      kernelInfo
    );
  }
  function dilate(values, width, height, radius) {
    if (!Number.isFinite(radius) || radius <= 0) return new Float32Array(values);
    const roundedRadius = Math.max(1, Math.round(radius));
    const radiusSquared = roundedRadius * roundedRadius;
    const out = new Float32Array(values.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let maxValue = 0;
        for (let dy = -roundedRadius; dy <= roundedRadius; dy++) {
          for (let dx = -roundedRadius; dx <= roundedRadius; dx++) {
            if (dx * dx + dy * dy > radiusSquared) continue;
            const sx = x + dx;
            const sy = y + dy;
            if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
            maxValue = Math.max(maxValue, values[sy * width + sx]);
          }
        }
        out[y * width + x] = maxValue;
      }
    }
    return out;
  }
  function createAlphaGradientMask({
    alphaMap,
    width,
    height = width,
    strength = 1,
    gamma = 0.5,
    dilateRadius = 2,
    blurSigma = 2
  }) {
    if (!alphaMap || width <= 0 || height <= 0 || alphaMap.length < width * height) {
      return new Float32Array(0);
    }
    const gradient = new Float32Array(width * height);
    let minGradient = Number.POSITIVE_INFINITY;
    let maxGradient = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const gx = -alphaMap[i - width - 1] - 2 * alphaMap[i - 1] - alphaMap[i + width - 1] + alphaMap[i - width + 1] + 2 * alphaMap[i + 1] + alphaMap[i + width + 1];
        const gy = -alphaMap[i - width - 1] - 2 * alphaMap[i - width] - alphaMap[i - width + 1] + alphaMap[i + width - 1] + 2 * alphaMap[i + width] + alphaMap[i + width + 1];
        const value = Math.sqrt(gx * gx + gy * gy);
        gradient[i] = value;
        minGradient = Math.min(minGradient, value);
        maxGradient = Math.max(maxGradient, value);
      }
    }
    if (!Number.isFinite(minGradient) || maxGradient <= minGradient + EPSILON2) {
      return new Float32Array(width * height);
    }
    const normalized = new Float32Array(width * height);
    const exponent = Number.isFinite(gamma) && gamma > 0 ? gamma : 1;
    for (let i = 0; i < normalized.length; i++) {
      const value = (gradient[i] - minGradient) / (maxGradient - minGradient);
      normalized[i] = Math.pow(clamp3(value, 0, 1), exponent);
    }
    const expanded = dilate(normalized, width, height, dilateRadius);
    const blurred = gaussianBlur(expanded, width, height, blurSigma);
    const safeStrength = Number.isFinite(strength) ? Math.max(0, strength) : 1;
    for (let i = 0; i < blurred.length; i++) {
      blurred[i] = clamp3(blurred[i] * safeStrength, 0, 1);
    }
    return blurred;
  }
  function getAlphaGradientWeight(mask, index, floor = 0.35) {
    if (!mask || index < 0 || index >= mask.length) {
      return clamp3(floor, 0, 1);
    }
    return Math.max(clamp3(floor, 0, 1), clamp3(mask[index], 0, 1));
  }

  // src/core/watermarkDecisionPolicy.js
  var STANDARD_DIRECT_MATCH_MIN_SPATIAL_SCORE = 0.3;
  var STANDARD_DIRECT_MATCH_MIN_GRADIENT_SCORE = 0.12;
  var STANDARD_STRONG_GRADIENT_DIRECT_MATCH_MIN_SPATIAL_SCORE = 0.295;
  var STANDARD_STRONG_GRADIENT_DIRECT_MATCH_MIN_GRADIENT_SCORE = 0.45;
  var ADAPTIVE_DIRECT_MATCH_MIN_CONFIDENCE = 0.5;
  var ADAPTIVE_DIRECT_MATCH_MIN_SPATIAL_SCORE = 0.45;
  var ADAPTIVE_DIRECT_MATCH_MIN_GRADIENT_SCORE = 0.12;
  var ADAPTIVE_DIRECT_MATCH_MIN_SIZE = 40;
  var ADAPTIVE_DIRECT_MATCH_MAX_SIZE = 192;
  function toFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function classifyStandardWatermarkSignal({ spatialScore, gradientScore }) {
    const spatial = toFiniteNumber(spatialScore);
    const gradient = toFiniteNumber(gradientScore);
    if (spatial === null || gradient === null) {
      return { tier: "insufficient" };
    }
    if (spatial >= STANDARD_DIRECT_MATCH_MIN_SPATIAL_SCORE && gradient >= STANDARD_DIRECT_MATCH_MIN_GRADIENT_SCORE || spatial >= STANDARD_STRONG_GRADIENT_DIRECT_MATCH_MIN_SPATIAL_SCORE && gradient >= STANDARD_STRONG_GRADIENT_DIRECT_MATCH_MIN_GRADIENT_SCORE) {
      return { tier: "direct-match" };
    }
    if (spatial > 0 || gradient > 0) {
      return { tier: "needs-validation" };
    }
    return { tier: "insufficient" };
  }
  function classifyAdaptiveWatermarkSignal(adaptiveResult) {
    if (!adaptiveResult || adaptiveResult.found !== true) {
      return { tier: "insufficient" };
    }
    const confidence = toFiniteNumber(adaptiveResult.confidence);
    const spatial = toFiniteNumber(adaptiveResult.spatialScore);
    const gradient = toFiniteNumber(adaptiveResult.gradientScore);
    const size = toFiniteNumber(adaptiveResult?.region?.size);
    if (confidence === null || spatial === null || gradient === null || size === null) {
      return { tier: "insufficient" };
    }
    if (confidence >= ADAPTIVE_DIRECT_MATCH_MIN_CONFIDENCE && spatial >= ADAPTIVE_DIRECT_MATCH_MIN_SPATIAL_SCORE && gradient >= ADAPTIVE_DIRECT_MATCH_MIN_GRADIENT_SCORE && size >= ADAPTIVE_DIRECT_MATCH_MIN_SIZE && size <= ADAPTIVE_DIRECT_MATCH_MAX_SIZE) {
      return { tier: "direct-match" };
    }
    if (size >= ADAPTIVE_DIRECT_MATCH_MIN_SIZE && size <= ADAPTIVE_DIRECT_MATCH_MAX_SIZE && gradient >= ADAPTIVE_DIRECT_MATCH_MIN_GRADIENT_SCORE && (confidence > 0 || spatial > 0)) {
      return { tier: "needs-validation" };
    }
    return { tier: "insufficient" };
  }

  // src/core/watermarkPresence.js
  function hasReliableStandardWatermarkSignal({ spatialScore, gradientScore }) {
    return classifyStandardWatermarkSignal({ spatialScore, gradientScore }).tier === "direct-match";
  }
  function hasReliableAdaptiveWatermarkSignal(adaptiveResult) {
    return classifyAdaptiveWatermarkSignal(adaptiveResult).tier === "direct-match";
  }

  // src/core/watermarkScoring.js
  var DEFAULT_CLEARED_SPATIAL_RESIDUAL = 0.04;
  var DEFAULT_CLEARED_GRADIENT_RESIDUAL = 0.12;
  var DEFAULT_EARLY_ACCEPT_MAX_SOURCE_PRIORITY = 3;
  var DEFAULT_EARLY_ACCEPT_MIN_SUPPRESSION_GAIN = 0.25;
  var DEFAULT_BALANCED_GRADIENT_WEIGHT = 0.6;
  var DEFAULT_BALANCED_NEAR_BLACK_WEIGHT = 3;
  var DEFAULT_BALANCED_TEXTURE_WEIGHT = 0.7;
  var DEFAULT_BALANCED_CLIPPING_WEIGHT = 2;
  var DEFAULT_BALANCED_DARK_HALO_WEIGHT = 0.012;
  var DEFAULT_BALANCED_ARTIFACT_WEIGHT = 0.35;
  var DEFAULT_BALANCED_GRADIENT_REGRESSION_WEIGHT = 0.25;
  function toFiniteNumber2(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function scoreOriginalEvidence({ spatial, gradient } = {}) {
    const resolvedSpatial = toFiniteNumber2(spatial) ?? 0;
    const resolvedGradient = toFiniteNumber2(gradient) ?? 0;
    let tier = "none";
    if (resolvedSpatial >= 0.3 && resolvedGradient >= 0.12 || resolvedGradient >= 0.45) {
      tier = "strong";
    } else if (resolvedSpatial >= 0.15 || resolvedGradient >= 0.08) {
      tier = "medium";
    } else if (resolvedSpatial >= 0.05 || resolvedGradient >= 0.03) {
      tier = "weak";
    }
    return {
      tier,
      spatial: spatial ?? null,
      gradient: gradient ?? null,
      score: resolvedSpatial + Math.max(0, resolvedGradient) * 0.8
    };
  }
  function originalEvidenceRank(tier) {
    if (tier === "strong") return 3;
    if (tier === "medium") return 2;
    if (tier === "weak") return 1;
    return 0;
  }
  function scoreResidual({
    processedSpatial,
    processedGradient,
    suppressionGain = null,
    artifactCost = 0,
    clearedSpatialResidual = DEFAULT_CLEARED_SPATIAL_RESIDUAL,
    clearedGradientResidual = DEFAULT_CLEARED_GRADIENT_RESIDUAL
  } = {}) {
    const spatial = toFiniteNumber2(processedSpatial);
    const gradient = toFiniteNumber2(processedGradient);
    const spatialResidual = Math.abs(spatial ?? 0);
    const gradientResidual = Math.max(0, gradient ?? 0);
    const cost = toFiniteNumber2(artifactCost) ?? 0;
    return {
      cleared: spatialResidual <= clearedSpatialResidual && gradientResidual <= clearedGradientResidual,
      spatial,
      gradient,
      spatialResidual,
      gradientResidual,
      suppressionGain: toFiniteNumber2(suppressionGain),
      artifactCost: cost,
      score: spatialResidual + gradientResidual * 0.6 + cost * 0.25
    };
  }
  function scoreDamage({
    hardReject = false,
    nearBlackIncrease = 0,
    texturePenalty = 0,
    newlyClippedRatio = 0,
    halo = null
  } = {}) {
    const resolvedNearBlackIncrease = toFiniteNumber2(nearBlackIncrease) ?? 0;
    const resolvedTexturePenalty = toFiniteNumber2(texturePenalty) ?? 0;
    const resolvedNewlyClippedRatio = toFiniteNumber2(newlyClippedRatio) ?? 0;
    const reasons = [];
    if (hardReject === true) reasons.push("hard-reject");
    if (resolvedNearBlackIncrease > 0.05) reasons.push("near-black");
    if (resolvedTexturePenalty > 0.25) reasons.push("texture");
    if (resolvedNewlyClippedRatio > 0.03) reasons.push("clipping");
    return {
      safe: reasons.length === 0,
      penalty: Math.max(0, resolvedNearBlackIncrease) * 3 + resolvedTexturePenalty + resolvedNewlyClippedRatio * 8,
      reason: reasons.length > 0 ? reasons.join(",") : null,
      nearBlackIncrease: nearBlackIncrease ?? null,
      texturePenalty: texturePenalty ?? null,
      newlyClippedRatio: newlyClippedRatio ?? null,
      halo
    };
  }
  function scoreBalancedVisualCandidate({
    processedSpatial,
    processedGradient,
    nearBlackIncrease = 0,
    texturePenalty = 0,
    newlyClippedRatio = 0,
    darkHaloLum = 0,
    visualArtifactCost = null,
    gradientIncrease = 0,
    gradientWeight = DEFAULT_BALANCED_GRADIENT_WEIGHT,
    nearBlackWeight = DEFAULT_BALANCED_NEAR_BLACK_WEIGHT,
    textureWeight = DEFAULT_BALANCED_TEXTURE_WEIGHT,
    clippingWeight = DEFAULT_BALANCED_CLIPPING_WEIGHT,
    darkHaloWeight = DEFAULT_BALANCED_DARK_HALO_WEIGHT,
    artifactWeight = DEFAULT_BALANCED_ARTIFACT_WEIGHT,
    gradientRegressionWeight = DEFAULT_BALANCED_GRADIENT_REGRESSION_WEIGHT
  } = {}) {
    const spatial = toFiniteNumber2(processedSpatial) ?? 0;
    const gradient = toFiniteNumber2(processedGradient) ?? 0;
    const resolvedNearBlackIncrease = Math.max(0, toFiniteNumber2(nearBlackIncrease) ?? 0);
    const resolvedTexturePenalty = Math.max(0, toFiniteNumber2(texturePenalty) ?? 0);
    const resolvedNewlyClippedRatio = Math.max(0, toFiniteNumber2(newlyClippedRatio) ?? 0);
    const resolvedDarkHaloLum = Math.max(0, toFiniteNumber2(darkHaloLum) ?? 0);
    const resolvedVisualArtifactCost = Math.max(0, toFiniteNumber2(visualArtifactCost) ?? 0);
    const resolvedGradientIncrease = Math.max(0, toFiniteNumber2(gradientIncrease) ?? 0);
    const residualCost = Math.abs(spatial) + Math.max(0, gradient) * gradientWeight;
    const damageCost = resolvedNearBlackIncrease * nearBlackWeight + resolvedTexturePenalty * textureWeight + resolvedNewlyClippedRatio * clippingWeight + resolvedDarkHaloLum * darkHaloWeight + resolvedVisualArtifactCost * artifactWeight + resolvedGradientIncrease * gradientRegressionWeight;
    return {
      score: residualCost + damageCost,
      residualCost,
      damageCost,
      spatial,
      gradient,
      nearBlackIncrease: resolvedNearBlackIncrease,
      texturePenalty: resolvedTexturePenalty,
      newlyClippedRatio: resolvedNewlyClippedRatio,
      darkHaloLum: resolvedDarkHaloLum,
      visualArtifactCost: resolvedVisualArtifactCost,
      gradientIncrease: resolvedGradientIncrease
    };
  }
  function buildRankingKey({
    sourcePriority = 9,
    originalEvidenceTier = "none",
    damageSafe = false,
    residualScore = 0,
    alphaPriorityIndex = 99,
    damagePenalty = 0
  } = {}) {
    return [
      sourcePriority,
      -originalEvidenceRank(originalEvidenceTier),
      damageSafe ? 0 : 1,
      Number((toFiniteNumber2(residualScore) ?? 0).toFixed(6)),
      alphaPriorityIndex,
      Number((toFiniteNumber2(damagePenalty) ?? 0).toFixed(6))
    ];
  }
  function compareRankingKey(left, right) {
    const length = Math.max(left?.length ?? 0, right?.length ?? 0);
    for (let index = 0; index < length; index++) {
      const leftValue = left?.[index] ?? 0;
      const rightValue = right?.[index] ?? 0;
      if (leftValue !== rightValue) return leftValue - rightValue;
    }
    return 0;
  }
  function shouldEarlyAccept({
    sourcePriority = 9,
    originalEvidence = null,
    residual = null,
    damage = null,
    maxSourcePriority = DEFAULT_EARLY_ACCEPT_MAX_SOURCE_PRIORITY,
    minSuppressionGain = DEFAULT_EARLY_ACCEPT_MIN_SUPPRESSION_GAIN
  } = {}) {
    const resolvedSourcePriority = toFiniteNumber2(sourcePriority) ?? 9;
    const suppressionGain = toFiniteNumber2(residual?.suppressionGain) ?? 0;
    return resolvedSourcePriority <= maxSourcePriority && originalEvidence?.tier === "strong" && residual?.cleared === true && suppressionGain >= minSuppressionGain && damage?.safe === true;
  }

  // src/core/pipelineDetectionCandidate.js
  var PRODUCTION_EVIDENCE_MIN_SPATIAL = 0.45;
  var PRODUCTION_EVIDENCE_MIN_GRADIENT = 0.16;
  function numberOr(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function finiteOrNull(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function normalizeConfig(config) {
    if (!config || typeof config !== "object") return null;
    const { logoSize, marginRight, marginBottom } = config;
    if (![logoSize, marginRight, marginBottom].every(Number.isFinite)) return null;
    return {
      logoSize,
      marginRight,
      marginBottom,
      ...typeof config.alphaVariant === "string" && config.alphaVariant.length > 0 ? { alphaVariant: config.alphaVariant } : {}
    };
  }
  function normalizePosition(position) {
    if (!position || typeof position !== "object") return null;
    const { x, y, width, height } = position;
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return { x, y, width, height };
  }
  function makeCandidateId(prefix, config, position, source) {
    const normalizedConfig = normalizeConfig(config);
    const normalizedPosition = normalizePosition(position);
    const configKey = normalizedConfig ? `${normalizedConfig.logoSize}/${normalizedConfig.marginRight}/${normalizedConfig.marginBottom}${normalizedConfig.alphaVariant ? `/${normalizedConfig.alphaVariant}` : ""}` : "none";
    const positionKey = normalizedPosition ? `${normalizedPosition.x},${normalizedPosition.y},${normalizedPosition.width},${normalizedPosition.height}` : "none";
    return `${prefix}:${configKey}:${positionKey}:${source || "unknown"}`;
  }
  function hasProductionEvidenceScores({ spatialScore, gradientScore }) {
    return numberOr(spatialScore, -Infinity) >= PRODUCTION_EVIDENCE_MIN_SPATIAL && numberOr(gradientScore, -Infinity) >= PRODUCTION_EVIDENCE_MIN_GRADIENT;
  }
  function createDetectionCandidateFromSelectedTrial({
    selectedTrial = null,
    source = null,
    config = null,
    position = null,
    adaptiveConfidence = null,
    decisionTier = null
  } = {}) {
    const resolvedConfig = normalizeConfig(config ?? selectedTrial?.config);
    const resolvedPosition = normalizePosition(position ?? selectedTrial?.position);
    const originalSpatial = finiteOrNull(selectedTrial?.originalSpatialScore);
    const originalGradient = finiteOrNull(selectedTrial?.originalGradientScore);
    return {
      id: makeCandidateId("det", resolvedConfig, resolvedPosition, source ?? selectedTrial?.source),
      source: source ?? selectedTrial?.source ?? null,
      decisionTier,
      config: resolvedConfig,
      position: resolvedPosition,
      alphaMapHint: resolvedConfig?.alphaVariant ? `${resolvedConfig.logoSize}-${resolvedConfig.alphaVariant}` : resolvedConfig?.logoSize ?? null,
      polarityHint: selectedTrial?.provenance?.darkPolarity === true ? "dark" : "white",
      evidence: {
        spatialScore: originalSpatial,
        gradientScore: originalGradient,
        confidence: finiteOrNull(adaptiveConfidence ?? selectedTrial?.adaptiveConfidence),
        productionEvidence: hasProductionEvidenceScores({
          spatialScore: originalSpatial,
          gradientScore: originalGradient
        }),
        originalEvidenceTier: selectedTrial?.originalEvidence?.tier ?? null
      },
      provenance: selectedTrial?.provenance ?? null
    };
  }
  function createRejectedDetectionCandidate({
    reason = "no-watermark-detected",
    source = "skipped",
    decisionTier = "insufficient",
    originalSpatialScore = null,
    originalGradientScore = null,
    adaptiveConfidence = null
  } = {}) {
    return {
      id: `det:rejected:${reason}`,
      source,
      decisionTier,
      config: null,
      position: null,
      alphaMapHint: null,
      polarityHint: null,
      evidence: {
        spatialScore: finiteOrNull(originalSpatialScore),
        gradientScore: finiteOrNull(originalGradientScore),
        confidence: finiteOrNull(adaptiveConfidence),
        productionEvidence: hasProductionEvidenceScores({
          spatialScore: originalSpatialScore,
          gradientScore: originalGradientScore
        }),
        originalEvidenceTier: null
      },
      provenance: null
    };
  }

  // src/core/pipelineAlphaTrial.js
  function finiteOrNull2(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function normalizeConfig2(config) {
    if (!config || typeof config !== "object") return null;
    const { logoSize, marginRight, marginBottom } = config;
    if (![logoSize, marginRight, marginBottom].every(Number.isFinite)) return null;
    return {
      logoSize,
      marginRight,
      marginBottom,
      ...typeof config.alphaVariant === "string" && config.alphaVariant.length > 0 ? { alphaVariant: config.alphaVariant } : {}
    };
  }
  function normalizePosition2(position) {
    if (!position || typeof position !== "object") return null;
    const { x, y, width, height } = position;
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return { x, y, width, height };
  }
  function compactObject(object) {
    return Object.fromEntries(
      Object.entries(object).filter(([, value]) => value !== void 0 && value !== null)
    );
  }
  function makeCandidateId2(prefix, config, position, source) {
    const normalizedConfig = normalizeConfig2(config);
    const normalizedPosition = normalizePosition2(position);
    const configKey = normalizedConfig ? `${normalizedConfig.logoSize}/${normalizedConfig.marginRight}/${normalizedConfig.marginBottom}${normalizedConfig.alphaVariant ? `/${normalizedConfig.alphaVariant}` : ""}` : "none";
    const positionKey = normalizedPosition ? `${normalizedPosition.x},${normalizedPosition.y},${normalizedPosition.width},${normalizedPosition.height}` : "none";
    return `${prefix}:${configKey}:${positionKey}:${source || "unknown"}`;
  }
  function normalizeStageList(alphaAdjustmentStages) {
    return Array.isArray(alphaAdjustmentStages) ? alphaAdjustmentStages.map((stage) => typeof stage === "string" ? { stage } : stage).filter((stage) => stage && typeof stage.stage === "string") : [];
  }
  function normalizeAlphaTrialEvents(alphaTrialEvents) {
    return Array.isArray(alphaTrialEvents) ? alphaTrialEvents.filter((event) => event && typeof event === "object").map((event) => compactObject({
      stage: typeof event.stage === "string" ? event.stage : null,
      strategy: typeof event.strategy === "string" ? event.strategy : null,
      decision: typeof event.decision === "string" ? event.decision : null,
      blockedGate: typeof event.blockedGate === "string" ? event.blockedGate : null,
      fromAlphaGain: finiteOrNull2(event.fromAlphaGain),
      toAlphaGain: finiteOrNull2(event.toAlphaGain),
      alphaGain: finiteOrNull2(event.alphaGain),
      repeatCount: finiteOrNull2(event.repeatCount),
      edgeCleanup: typeof event.edgeCleanup === "boolean" ? event.edgeCleanup : null,
      currentSpatialScore: finiteOrNull2(event.currentSpatialScore),
      candidateSpatialScore: finiteOrNull2(event.candidateSpatialScore),
      spatialDrift: finiteOrNull2(event.spatialDrift),
      currentGradientScore: finiteOrNull2(event.currentGradientScore),
      candidateGradientScore: finiteOrNull2(event.candidateGradientScore),
      beforeSpatialScore: finiteOrNull2(event.beforeSpatialScore),
      beforeGradientScore: finiteOrNull2(event.beforeGradientScore),
      afterSpatialScore: finiteOrNull2(event.afterSpatialScore),
      afterGradientScore: finiteOrNull2(event.afterGradientScore),
      suppressionGain: finiteOrNull2(event.suppressionGain),
      currentCost: finiteOrNull2(event.currentCost),
      candidateCost: finiteOrNull2(event.candidateCost),
      cost: finiteOrNull2(event.cost)
    })) : [];
  }
  function classifyAlphaStages(alphaAdjustmentStages) {
    return normalizeStageList(alphaAdjustmentStages).filter(
      (stage) => /alpha|recalibration|over-subtraction|subpixel|new-margin-96-variant|power-profile|residual-rebalance|anti-template/i.test(stage.stage)
    );
  }
  function inferAlphaTrialStrategy({ source = null, config = null, alphaAdjustmentStages = null } = {}) {
    const sourceText = String(source ?? "");
    const stages = normalizeStageList(alphaAdjustmentStages).map((stage) => stage.stage);
    if (sourceText.includes("new-margin-variant") || stages.includes("new-margin-96-variant-rescue")) {
      return "new-margin-96-variant";
    }
    if (sourceText.includes("residual-rebalance") || stages.includes("known-48-positive-residual-rebalance")) {
      return "known-48-positive-residual-rebalance";
    }
    if (sourceText.includes("power-profile-rescue") || stages.includes("known-48-power-profile-rescue")) {
      return "known-48-power-profile";
    }
    if (sourceText.includes("located-aggressive") || stages.includes("located-aggressive-removal")) {
      return "located-aggressive-alpha";
    }
    if (stages.includes("dark-catalog-fine-alpha")) {
      return "dark-catalog-fine-alpha";
    }
    if (stages.includes("over-subtraction-recalibration") || stages.includes("weak-positive-residual-fine-alpha")) {
      return "over-subtraction-fine-alpha";
    }
    if (sourceText.includes("fine-alpha") || stages.some((stage) => stage.includes("fine-alpha"))) {
      return "fine-alpha";
    }
    if (normalizeConfig2(config)?.alphaVariant) {
      return "alpha-variant";
    }
    return "selected-alpha";
  }
  function isPhase2AlphaTrialStrategy(strategy) {
    return strategy === "new-margin-96-variant" || strategy === "known-48-positive-residual-rebalance" || strategy === "known-48-power-profile" || strategy === "over-subtraction-fine-alpha" || strategy === "dark-catalog-fine-alpha";
  }
  function createAlphaTrialFromSelectedTrial({
    selectedTrial = null,
    detectionCandidate = null,
    source = null,
    config = null,
    position = null,
    alphaGain = null,
    alphaMapSource = null,
    templateWarp = null,
    alphaAdjustmentStages = null,
    alphaTrialEvents = null,
    processedSpatialScore = null,
    processedGradientScore = null,
    suppressionGain = null
  } = {}) {
    const resolvedConfig = normalizeConfig2(config ?? selectedTrial?.config ?? detectionCandidate?.config);
    const resolvedPosition = normalizePosition2(position ?? selectedTrial?.position ?? detectionCandidate?.position);
    const resolvedSource = source ?? selectedTrial?.source ?? null;
    const resolvedAlphaGain = finiteOrNull2(alphaGain ?? selectedTrial?.alphaGain) ?? 1;
    const alphaStages = classifyAlphaStages(alphaAdjustmentStages);
    const trialEvents = normalizeAlphaTrialEvents(alphaTrialEvents);
    const strategy = inferAlphaTrialStrategy({
      source: resolvedSource,
      config: resolvedConfig,
      alphaAdjustmentStages
    });
    const originalSpatial = finiteOrNull2(selectedTrial?.originalSpatialScore);
    const originalGradient = finiteOrNull2(selectedTrial?.originalGradientScore);
    const processedSpatial = finiteOrNull2(processedSpatialScore ?? selectedTrial?.processedSpatialScore);
    const processedGradient = finiteOrNull2(processedGradientScore ?? selectedTrial?.processedGradientScore);
    return {
      id: makeCandidateId2("alpha", resolvedConfig, resolvedPosition, `${resolvedSource}:${resolvedAlphaGain}`),
      detectionId: detectionCandidate?.id ?? null,
      source: resolvedSource,
      config: resolvedConfig,
      position: resolvedPosition,
      alphaMapSource: alphaMapSource ?? selectedTrial?.provenance?.alphaMapSource ?? null,
      alphaGain: resolvedAlphaGain,
      strategy,
      migrationStage: isPhase2AlphaTrialStrategy(strategy) ? "phase2-alpha-trial" : "phase1-adapter",
      alphaShape: compactObject({
        variant: resolvedConfig?.alphaVariant ?? null,
        templateWarp: templateWarp ?? null,
        profileStages: alphaStages.map((stage) => compactObject({
          stage: stage.stage,
          alphaStrategy: typeof stage.alphaStrategy === "string" ? stage.alphaStrategy : null,
          fromAlphaGain: finiteOrNull2(stage.fromAlphaGain),
          toAlphaGain: finiteOrNull2(stage.toAlphaGain),
          beforeSpatialScore: finiteOrNull2(stage.beforeSpatialScore),
          beforeGradientScore: finiteOrNull2(stage.beforeGradientScore),
          afterSpatialScore: finiteOrNull2(stage.afterSpatialScore),
          afterGradientScore: finiteOrNull2(stage.afterGradientScore),
          suppressionGain: finiteOrNull2(stage.suppressionGain),
          cost: finiteOrNull2(stage.cost),
          profileExponent: finiteOrNull2(stage.profileExponent)
        })),
        stages: alphaStages.map((stage) => stage.stage)
      }),
      acceptedStrategies: trialEvents.filter((event) => event.decision === "accept"),
      rejectedStrategies: trialEvents.filter((event) => event.decision === "reject"),
      scores: {
        originalSpatial,
        originalGradient,
        processedSpatial,
        processedGradient,
        suppressionGain: finiteOrNull2(suppressionGain ?? selectedTrial?.improvement)
      },
      gates: selectedTrial?.evaluation?.gates ?? null,
      damage: selectedTrial?.damage ?? null,
      residual: selectedTrial?.residual ?? null,
      provenance: selectedTrial?.provenance ?? null
    };
  }

  // src/core/pipelineRepairTrial.js
  var ALPHA_STAGE_PATTERNS = Object.freeze([
    /alpha/i,
    /recalibration/i,
    /over-subtraction/i,
    /subpixel/i,
    /new-margin-96-variant/i,
    /power-profile/i,
    /residual-rebalance/i,
    /anti-template/i
  ]);
  var REPAIR_STAGE_PATTERNS = Object.freeze([
    /cleanup/i,
    /edge/i,
    /repair/i,
    /flat.*fill/i,
    /prior/i,
    /halo/i,
    /boundary/i,
    /quantized/i,
    /mid-core/i,
    /background/i
  ]);
  function finiteOrNull3(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function compactObject2(object) {
    return Object.fromEntries(
      Object.entries(object).filter(([, value]) => value !== void 0 && value !== null)
    );
  }
  function stageMatches(stage, patterns) {
    return patterns.some((pattern) => pattern.test(stage));
  }
  function normalizeStageList2(alphaAdjustmentStages) {
    return Array.isArray(alphaAdjustmentStages) ? alphaAdjustmentStages.map((stage) => typeof stage === "string" ? { stage } : stage).filter((stage) => stage && typeof stage.stage === "string") : [];
  }
  function classifyRepairStages(alphaAdjustmentStages) {
    return normalizeStageList2(alphaAdjustmentStages).filter((stage) => {
      const name = stage.stage;
      return stageMatches(name, REPAIR_STAGE_PATTERNS) && !(stageMatches(name, ALPHA_STAGE_PATTERNS) && !/repair|cleanup|flat.*fill|prior|halo|boundary|quantized|mid-core|background/i.test(name));
    });
  }
  function inferRepairStrategy(stageName) {
    const name = String(stageName ?? "");
    if (/luma-edge/i.test(name)) return "luma-edge";
    if (/edge-cleanup/i.test(name)) return "edge-cleanup";
    if (/known-48-flat/i.test(name)) return "known-48-flat-fill";
    if (/new-margin-96-flat/i.test(name)) return "new-margin-96-flat-fill";
    if (/flat.*fill/i.test(name)) return "flat-fill";
    if (/smooth-located-estimated-prior/i.test(name)) return "smooth-located-prior";
    if (/small-margin-prior/i.test(name)) return "small-margin-prior";
    if (/small-located-prior/i.test(name)) return "small-located-prior";
    if (/prior/i.test(name)) return "estimated-prior";
    if (/dark-halo/i.test(name)) return "dark-halo-repair";
    if (/canonical-96-positive-halo/i.test(name)) return "canonical-96-positive-halo-repair";
    if (/halo/i.test(name)) return "halo-repair";
    if (/boundary/i.test(name)) return "boundary-repair";
    if (/quantized/i.test(name)) return "quantized-body-correction";
    if (/mid-core/i.test(name)) return "mid-core-bias-correction";
    if (/background/i.test(name)) return "background-cleanup";
    return "repair";
  }
  function createRepairTrialFromStages({
    alphaTrial = null,
    source = null,
    alphaAdjustmentStages = null,
    processedSpatialScore = null,
    processedGradientScore = null,
    suppressionGain = null,
    residualVisibility = null
  } = {}) {
    const repairStages = classifyRepairStages(alphaAdjustmentStages);
    if (repairStages.length === 0) {
      return {
        id: `${alphaTrial?.id ?? "alpha:none"}:repair:none`,
        alphaTrialId: alphaTrial?.id ?? null,
        source: null,
        repairType: "none",
        applied: false,
        params: null,
        scores: null,
        artifacts: null,
        gates: null,
        provenance: null
      };
    }
    return {
      id: `${alphaTrial?.id ?? "alpha:none"}:repair:${repairStages.map((stage) => stage.stage).join("+")}`,
      alphaTrialId: alphaTrial?.id ?? null,
      source,
      repairType: inferRepairStrategy(repairStages.at(-1)?.stage),
      applied: true,
      params: repairStages.map((stage) => compactObject2({
        stage: stage.stage,
        repairStrategy: typeof stage.repairStrategy === "string" ? stage.repairStrategy : inferRepairStrategy(stage.stage),
        fromAlphaGain: finiteOrNull3(stage.fromAlphaGain),
        toAlphaGain: finiteOrNull3(stage.toAlphaGain),
        beforeSpatialScore: finiteOrNull3(stage.beforeSpatialScore),
        beforeGradientScore: finiteOrNull3(stage.beforeGradientScore),
        afterSpatialScore: finiteOrNull3(stage.afterSpatialScore),
        afterGradientScore: finiteOrNull3(stage.afterGradientScore),
        suppressionGain: finiteOrNull3(stage.suppressionGain),
        cost: finiteOrNull3(stage.cost)
      })),
      scores: {
        processedSpatial: finiteOrNull3(processedSpatialScore),
        processedGradient: finiteOrNull3(processedGradientScore),
        suppressionGain: finiteOrNull3(suppressionGain)
      },
      artifacts: residualVisibility ?? null,
      gates: {
        stageCount: repairStages.length,
        stages: repairStages.map((stage) => stage.stage)
      },
      provenance: {
        stageCount: repairStages.length,
        strategies: [...new Set(repairStages.map((stage) => typeof stage.repairStrategy === "string" ? stage.repairStrategy : inferRepairStrategy(stage.stage)))]
      }
    };
  }

  // src/core/pipelineDecisionPath.js
  function finiteOrNull4(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  function createAcceptedDecisionPath({
    selectedTrial = null,
    selectionSource = null,
    source = null,
    decisionTier = null,
    config = null,
    position = null,
    adaptiveConfidence = null,
    alphaGain = 1,
    alphaMapSource = null,
    templateWarp = null,
    alphaAdjustmentStages = null,
    alphaTrialEvents = null,
    originalSpatialScore = null,
    originalGradientScore = null,
    processedSpatialScore = null,
    processedGradientScore = null,
    suppressionGain = null,
    residualVisibility = null
  } = {}) {
    const detectionCandidate = createDetectionCandidateFromSelectedTrial({
      selectedTrial,
      source: selectionSource ?? source,
      config,
      position,
      adaptiveConfidence,
      decisionTier
    });
    const alphaTrial = createAlphaTrialFromSelectedTrial({
      selectedTrial,
      detectionCandidate,
      source,
      config,
      position,
      alphaGain,
      alphaMapSource,
      templateWarp,
      alphaAdjustmentStages,
      alphaTrialEvents,
      processedSpatialScore,
      processedGradientScore,
      suppressionGain
    });
    const repairTrial = createRepairTrialFromStages({
      alphaTrial,
      source,
      alphaAdjustmentStages,
      processedSpatialScore,
      processedGradientScore,
      suppressionGain,
      residualVisibility
    });
    const evaluation = {
      ...selectedTrial?.evaluation ?? {},
      pathId: `${detectionCandidate.id}->${alphaTrial.id}->${repairTrial.id}`,
      detectionId: detectionCandidate.id,
      alphaTrialId: alphaTrial.id,
      repairTrialId: repairTrial.id,
      eligible: selectedTrial?.evaluation?.eligible !== false,
      decision: "accept",
      blockedGate: null,
      riskFlags: selectedTrial?.evaluation?.riskFlags ?? [],
      finalScores: {
        originalSpatial: finiteOrNull4(originalSpatialScore ?? selectedTrial?.originalSpatialScore),
        originalGradient: finiteOrNull4(originalGradientScore ?? selectedTrial?.originalGradientScore),
        processedSpatial: finiteOrNull4(processedSpatialScore),
        processedGradient: finiteOrNull4(processedGradientScore),
        suppressionGain: finiteOrNull4(suppressionGain)
      },
      explanation: "selected trial accepted by current production path"
    };
    return {
      version: 1,
      decision: "accept",
      detectionSource: detectionCandidate.source,
      alphaSource: alphaTrial.source,
      repairSource: repairTrial.applied ? repairTrial.source : null,
      evaluationDecision: "accepted",
      blockedGate: null,
      riskFlags: evaluation.riskFlags,
      detectionCandidate,
      alphaTrial,
      repairTrial,
      evaluation
    };
  }
  function createRejectedDecisionPath({
    reason = "no-watermark-detected",
    source = "skipped",
    decisionTier = "insufficient",
    originalSpatialScore = null,
    originalGradientScore = null,
    adaptiveConfidence = null
  } = {}) {
    const detectionCandidate = createRejectedDetectionCandidate({
      reason,
      source,
      decisionTier,
      originalSpatialScore,
      originalGradientScore,
      adaptiveConfidence
    });
    const evaluation = {
      pathId: `${detectionCandidate.id}->reject`,
      detectionId: detectionCandidate.id,
      alphaTrialId: null,
      repairTrialId: null,
      eligible: false,
      decision: "reject",
      blockedGate: reason,
      riskFlags: [],
      evidenceClass: detectionCandidate.evidence.productionEvidence ? "evidence-without-selected-path" : "insufficient-production-evidence",
      explanation: reason
    };
    return {
      version: 1,
      decision: "reject",
      detectionSource: source,
      alphaSource: null,
      repairSource: null,
      evaluationDecision: "rejected",
      blockedGate: reason,
      riskFlags: [],
      detectionCandidate,
      alphaTrial: null,
      repairTrial: null,
      evaluation
    };
  }

  // src/core/candidateEvaluation.js
  var NEW_MARGIN_96_SIZE = 96;
  var NEW_MARGIN_96_MARGIN = 192;
  var HIGH_RISK_NEW_MARGIN_MIN_SPATIAL = 0.4;
  var HIGH_RISK_NEW_MARGIN_MIN_GRADIENT = 0.08;
  var DEFAULT_ALPHA_NEW_MARGIN_MAX_SPATIAL_RESIDUAL = 0.18;
  var DEFAULT_ALPHA_NEW_MARGIN_MAX_GRADIENT_RESIDUAL = 0.08;
  var DEFAULT_ALPHA_NEW_MARGIN_MIN_IMPROVEMENT = 0.12;
  var DEFAULT_ALPHA_NEW_MARGIN_DAMAGE_ADVANTAGE = 0.03;
  function numberOr2(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function getConfig(candidate) {
    return candidate?.config ?? candidate ?? {};
  }
  function getProvenance(candidate) {
    return candidate?.provenance ?? {};
  }
  function isNewMargin96Candidate(candidate) {
    const config = getConfig(candidate);
    return config.logoSize === NEW_MARGIN_96_SIZE && config.marginRight === NEW_MARGIN_96_MARGIN && config.marginBottom === NEW_MARGIN_96_MARGIN;
  }
  function isNewMarginAlphaVariantTrial(candidate) {
    const config = getConfig(candidate);
    return isNewMargin96Candidate(candidate) && config.alphaVariant === "20260520";
  }
  function isDefaultAlphaNewMarginTrial(candidate) {
    const config = getConfig(candidate);
    return isNewMargin96Candidate(candidate) && !config.alphaVariant;
  }
  function hasClearedResidual(candidate) {
    return candidate?.residual?.cleared === true || candidate?.evaluation?.postResidual?.cleared === true;
  }
  function hasSafeDefaultAlphaNewMarginResidual(candidate) {
    if (candidate?.evaluation?.postResidual?.safeDefaultAlphaNewMargin === true) {
      return true;
    }
    return Math.abs(numberOr2(candidate?.processedSpatialScore, Infinity)) <= DEFAULT_ALPHA_NEW_MARGIN_MAX_SPATIAL_RESIDUAL && Math.max(0, numberOr2(candidate?.processedGradientScore, Infinity)) <= DEFAULT_ALPHA_NEW_MARGIN_MAX_GRADIENT_RESIDUAL && numberOr2(candidate?.improvement, -Infinity) >= DEFAULT_ALPHA_NEW_MARGIN_MIN_IMPROVEMENT;
  }
  function hasHighRiskNewMarginPositiveEvidence(candidate) {
    if (getProvenance(candidate).darkPolarity === true) return true;
    if (!isNewMarginAlphaVariantTrial(candidate) && !isDefaultAlphaNewMarginTrial(candidate)) return true;
    return numberOr2(candidate?.originalGradientScore) >= HIGH_RISK_NEW_MARGIN_MIN_GRADIENT || numberOr2(candidate?.originalSpatialScore) >= HIGH_RISK_NEW_MARGIN_MIN_SPATIAL;
  }
  function shouldFailClosedForVisibleResidualUnsafeDamage({
    selectedTrial = null,
    residualVisibility = null
  } = {}) {
    return isNewMarginAlphaVariantTrial(selectedTrial) && residualVisibility?.visible === true && selectedTrial?.damage?.safe === false;
  }
  function firstFalseGate(gates) {
    for (const [name, allowed] of Object.entries(gates)) {
      if (!allowed) return name;
    }
    return null;
  }
  function classifyCandidatePath(candidate) {
    if (isDefaultAlphaNewMarginTrial(candidate)) return "standard-new-margin-default-alpha";
    if (isNewMarginAlphaVariantTrial(candidate)) return "standard-new-margin-alpha-variant";
    if (candidate?.provenance?.previewAnchor === true) return "preview-anchor";
    if (candidate?.provenance?.adaptive === true) return "adaptive";
    if (typeof candidate?.source === "string" && candidate.source.startsWith("standard")) return "standard";
    return "unknown";
  }
  function createCandidateEvaluation({
    source = null,
    config = null,
    provenance = null,
    originalScores = null,
    processedScores = null,
    improvement = 0,
    residual = null,
    damage = null,
    gates = {}
  }) {
    const candidateLike = {
      source,
      config,
      provenance,
      originalSpatialScore: originalScores?.spatialScore,
      originalGradientScore: originalScores?.gradientScore,
      processedSpatialScore: processedScores?.spatialScore,
      processedGradientScore: processedScores?.gradientScore,
      improvement
    };
    const originalSpatial = numberOr2(originalScores?.spatialScore);
    const originalGradient = numberOr2(originalScores?.gradientScore);
    const processedSpatial = numberOr2(processedScores?.spatialScore);
    const processedGradient = numberOr2(processedScores?.gradientScore);
    const normalizedGates = {
      ...gates,
      highRiskNewMarginEvidenceAllowed: hasHighRiskNewMarginPositiveEvidence(candidateLike)
    };
    const blockedGate = firstFalseGate(normalizedGates);
    return {
      pathType: classifyCandidatePath(candidateLike),
      eligible: blockedGate === null,
      blockedGate,
      gates: normalizedGates,
      riskFlags: normalizedGates.highRiskNewMarginEvidenceAllowed ? [] : ["weak-new-margin-positive-alpha-evidence"],
      baseline: {
        spatialResidual: Math.abs(originalSpatial),
        gradientResidual: Math.max(0, originalGradient)
      },
      candidate: {
        spatialResidual: Math.abs(processedSpatial),
        gradientResidual: Math.max(0, processedGradient),
        improvement: numberOr2(improvement)
      },
      postResidual: {
        cleared: residual?.cleared === true,
        safeDefaultAlphaNewMargin: Math.abs(processedSpatial) <= DEFAULT_ALPHA_NEW_MARGIN_MAX_SPATIAL_RESIDUAL && Math.max(0, processedGradient) <= DEFAULT_ALPHA_NEW_MARGIN_MAX_GRADIENT_RESIDUAL && numberOr2(improvement, -Infinity) >= DEFAULT_ALPHA_NEW_MARGIN_MIN_IMPROVEMENT
      },
      damage: {
        safe: damage?.safe === true,
        penalty: numberOr2(damage?.penalty, Infinity)
      }
    };
  }
  function shouldPreferDefaultAlphaNewMarginCandidate(currentBest, candidate) {
    if (!isDefaultAlphaNewMarginTrial(candidate)) return false;
    if (isNewMarginAlphaVariantTrial(currentBest)) {
      return hasSafeDefaultAlphaNewMarginResidual(candidate) && !hasClearedResidual(currentBest);
    }
    if (!isDefaultAlphaNewMarginTrial(currentBest)) return false;
    if (!hasSafeDefaultAlphaNewMarginResidual(candidate)) return false;
    if (!hasSafeDefaultAlphaNewMarginResidual(currentBest)) return false;
    const currentDamage = numberOr2(currentBest?.damage?.penalty, Infinity);
    const candidateDamage = numberOr2(candidate?.damage?.penalty, Infinity);
    if (!Number.isFinite(currentDamage) || !Number.isFinite(candidateDamage)) return false;
    return candidateDamage + DEFAULT_ALPHA_NEW_MARGIN_DAMAGE_ADVANTAGE < currentDamage;
  }
  function arbitrateCandidateByEvaluation(currentBest, candidate) {
    if (shouldPreferDefaultAlphaNewMarginCandidate(currentBest, candidate)) {
      return candidate;
    }
    if (shouldPreferDefaultAlphaNewMarginCandidate(candidate, currentBest)) {
      return currentBest;
    }
    return null;
  }

  // src/core/candidateSelector.js
  var MAX_NEAR_BLACK_RATIO_INCREASE2 = 0.05;
  var VALIDATION_MIN_IMPROVEMENT = 0.08;
  var VALIDATION_TARGET_RESIDUAL = 0.22;
  var VALIDATION_MAX_GRADIENT_INCREASE = 0.04;
  var VALIDATION_MIN_CONFIDENCE_FOR_ADAPTIVE_TRIAL = 0.25;
  var STANDARD_FAST_PATH_RESIDUAL_THRESHOLD = 0.22;
  var STANDARD_FAST_PATH_GRADIENT_THRESHOLD = 0.08;
  var FIXED_CORE_MAX_ACCEPTED_SPATIAL_RESIDUAL = 0.45;
  var FIXED_CORE_STRONG_96_MAX_NEGATIVE_SPATIAL_RESIDUAL = 0.52;
  var FIXED_CORE_STRONG_96_MIN_ORIGINAL_SPATIAL_SCORE = 0.95;
  var FIXED_CORE_STRONG_96_MIN_ORIGINAL_GRADIENT_SCORE = 0.9;
  var FIXED_CORE_STRONG_96_MAX_PROCESSED_GRADIENT_SCORE = 0.16;
  var FIXED_CORE_STRONG_96_MIN_IMPROVEMENT = 0.45;
  var FIXED_CORE_STRONG_96_MAX_TEXTURE = 0.05;
  var FIXED_CORE_STRONG_96_MAX_NEAR_BLACK_INCREASE = 0.02;
  var FIXED_CORE_STRONG_96_LOW_RESIDUAL_MIN_ORIGINAL_SPATIAL_SCORE = 0.55;
  var FIXED_CORE_STRONG_96_LOW_RESIDUAL_MIN_ORIGINAL_GRADIENT_SCORE = 0.5;
  var FIXED_CORE_STRONG_96_LOW_RESIDUAL_MAX_SPATIAL_SCORE = 0.08;
  var FIXED_CORE_STRONG_96_LOW_RESIDUAL_MAX_GRADIENT_SCORE = 0.24;
  var FIXED_CORE_STRONG_96_LOW_RESIDUAL_MIN_IMPROVEMENT = 0.6;
  var STANDARD_EXPAND_CATALOG_MIN_ORIGINAL_GRADIENT = 0.12;
  var WEAK_ALPHA_PRIORITY_CLEAN_GRADIENT_THRESHOLD = 0.12;
  var STRONG_ORIGINAL_SIGNAL_SPATIAL_ADVANTAGE = 0.2;
  var STRONG_ORIGINAL_SIGNAL_GRADIENT_ADVANTAGE = 0.25;
  var STANDARD_NEARBY_SEARCH_RESIDUAL_THRESHOLD = 0.18;
  var STANDARD_NEARBY_SEARCH_GRADIENT_THRESHOLD = 0.05;
  var STANDARD_LOCAL_SHIFT_STRONG_BASE_GRADIENT_SCORE = 0.35;
  var STANDARD_LOCAL_SHIFT_STRONG_BASE_SPATIAL_SCORE = 0.8;
  var STANDARD_LOCAL_SHIFT_CANONICAL_MIN_GRADIENT_SCORE = 0.2;
  var STANDARD_LOCAL_SHIFT_CANONICAL_MIN_SPATIAL_SCORE = 0.22;
  var STANDARD_LOCAL_SHIFT_WEAK_CANDIDATE_GRADIENT_SCORE = 0.12;
  var STANDARD_LOCAL_SHIFT_WEAK_CANDIDATE_SPATIAL_SCORE = 0.65;
  var STANDARD_LOCAL_SHIFT_MIN_VALIDATION_ADVANTAGE = 0.3;
  var STANDARD_LOCAL_SHIFT_SKIP_PROCESSED_GRADIENT_THRESHOLD = 0.02;
  var STANDARD_LOCAL_SHIFT_PRESERVE_CLEAN_BASE_GRADIENT_THRESHOLD = 0.02;
  var STANDARD_LOCAL_SHIFT_MAX_CANDIDATE_GRADIENT_FOR_CLEAN_BASE = 0.03;
  var STANDARD_PRESERVE_GRADIENT_DELTA = 0.25;
  var STANDARD_PRESERVE_MAX_RESIDUAL = 0.4;
  var STANDARD_PRESERVE_MIN_IMPROVEMENT = 0.3;
  var STANDARD_TEXT_OVERLAP_MIN_SPATIAL_SCORE = 0.22;
  var STANDARD_TEXT_OVERLAP_MIN_GRADIENT_SCORE = 0.18;
  var STANDARD_TEXT_OVERLAP_MIN_IMPROVEMENT = 0.25;
  var STANDARD_TEXT_OVERLAP_MAX_RESIDUAL = 0.1;
  var STANDARD_TEXT_OVERLAP_MIN_GRADIENT_DROP = 0.1;
  var STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MIN_ORIGINAL_SPATIAL_SCORE = 0.12;
  var STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MIN_ORIGINAL_GRADIENT_SCORE = 0.06;
  var STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MIN_IMPROVEMENT = 0.08;
  var STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_SPATIAL_RESIDUAL = 0.08;
  var STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_GRADIENT_RESIDUAL = 0.08;
  var STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_NEAR_BLACK_INCREASE = 5e-3;
  var STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_TEXTURE = 0.05;
  var STANDARD_VALIDATION_MIN_ORIGINAL_SPATIAL_SCORE = 0.05;
  var STANDARD_VALIDATION_MIN_ORIGINAL_GRADIENT_SCORE = 0.12;
  var STANDARD_CONSERVATIVE_CATALOG_PREFERRED_ALPHA_GAIN = 0.55;
  var STANDARD_CONSERVATIVE_CATALOG_MAX_ALPHA_GAIN = 0.6;
  var STANDARD_CONSERVATIVE_CATALOG_MIN_ORIGINAL_SPATIAL_SCORE = 0.12;
  var STANDARD_CONSERVATIVE_CATALOG_MIN_ORIGINAL_GRADIENT_SCORE = 0.08;
  var STANDARD_CONSERVATIVE_CATALOG_MAX_RESIDUAL = 0.12;
  var STANDARD_CONSERVATIVE_CATALOG_MAX_GRADIENT = 0.12;
  var STANDARD_CONSERVATIVE_CATALOG_MIN_IMPROVEMENT = 0.12;
  var STANDARD_CONSERVATIVE_CATALOG_MAX_NEAR_BLACK_INCREASE = 5e-3;
  var STANDARD_VISIBLE_CATALOG_MAX_ALPHA_GAIN = 0.6;
  var STANDARD_VISIBLE_CATALOG_MIN_ORIGINAL_SPATIAL_SCORE = 0.45;
  var STANDARD_VISIBLE_CATALOG_MIN_ORIGINAL_GRADIENT_SCORE = 0.55;
  var STANDARD_VISIBLE_CATALOG_MAX_SPATIAL_RESIDUAL = 0.35;
  var STANDARD_VISIBLE_CATALOG_MAX_GRADIENT_RESIDUAL = 0.18;
  var STANDARD_VISIBLE_CATALOG_MIN_IMPROVEMENT = 0.7;
  var STANDARD_VISIBLE_CATALOG_MAX_NEAR_BLACK_INCREASE = 0.05;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_SPATIAL_SCORE = 0.9;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_GRADIENT_SCORE = 0.7;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_RESIDUAL = 0.16;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_GRADIENT = 0.16;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_IMPROVEMENT = 0.9;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_GRADIENT_DROP = 0.6;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_NEAR_BLACK_INCREASE = 0.01;
  var STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_TEXTURE = 0.1;
  var STANDARD_HARD_REJECT_OVERRIDE_MIN_SPATIAL_SCORE = 0.9;
  var STANDARD_HARD_REJECT_OVERRIDE_MIN_GRADIENT_SCORE = 0.7;
  var STANDARD_HARD_REJECT_OVERRIDE_MAX_RESIDUAL = 0.08;
  var STANDARD_HARD_REJECT_OVERRIDE_MAX_GRADIENT = 0.1;
  var STANDARD_HARD_REJECT_OVERRIDE_MIN_IMPROVEMENT = 0.7;
  var STANDARD_HARD_REJECT_OVERRIDE_MAX_NEAR_BLACK_INCREASE = 0.01;
  var STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_SPATIAL_SCORE = 0.9;
  var STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_GRADIENT_SCORE = 0.7;
  var STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MAX_RESIDUAL = 0.7;
  var STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MAX_GRADIENT = 0.32;
  var STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_IMPROVEMENT = 0.7;
  var STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_GRADIENT_DROP = 0.6;
  var STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MAX_NEAR_BLACK_INCREASE = 0.4;
  var BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_MIN_SPATIAL = 0.35;
  var BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_MIN_GRADIENT = 0.16;
  var BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_SPATIAL_ADVANTAGE = 0.18;
  var BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_GRADIENT_ADVANTAGE = 0.12;
  var BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_MAX_RESIDUAL_DELTA = 0.08;
  var DARK_POLARITY_CATALOG_MIN_ORIGINAL_SPATIAL = 0.12;
  var DARK_POLARITY_CATALOG_MIN_ORIGINAL_GRADIENT = 0.08;
  var DARK_POLARITY_CATALOG_MAX_TEXTURE_FOR_WEAK_EVIDENCE = 0.25;
  var TEMPLATE_ALIGN_SHIFTS = [-0.5, -0.25, 0, 0.25, 0.5];
  var TEMPLATE_ALIGN_SCALES = [0.99, 1, 1.01];
  var STANDARD_NEARBY_SHIFTS = [-12, -8, -4, 0, 4, 8, 12];
  var STANDARD_FINE_LOCAL_SHIFTS = [-2, -1, 0, 1, 2];
  var STANDARD_SIZE_JITTERS = [-12, -10, -8, -6, -4, -2, 2, 4, 6, 8, 10, 12];
  var FIXED_CORE_LOCAL_SIZE_DELTAS = [-3, -2, -1, 0, 1, 2, 3, 4];
  var FIXED_CORE_LOCAL_MARGIN_DELTAS = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
  var FIXED_CORE_LOCAL_MIN_ORIGINAL_SPATIAL_SCORE = 0.7;
  var FIXED_CORE_LOCAL_MIN_ORIGINAL_GRADIENT_SCORE = 0.3;
  var FIXED_CORE_LOCAL_VISIBLE_CATALOG_MIN_ORIGINAL_SPATIAL_SCORE = 0.45;
  var FIXED_CORE_LOCAL_VISIBLE_CATALOG_MIN_ORIGINAL_GRADIENT_SCORE = 0.55;
  var PREVIEW_ANCHOR_MIN_SIZE = 24;
  var PREVIEW_ANCHOR_MAX_SIZE_RATIO = 1.05;
  var PREVIEW_ANCHOR_MIN_SIZE_RATIO = 0.55;
  var PREVIEW_ANCHOR_MARGIN_WINDOW = 16;
  var PREVIEW_ANCHOR_MARGIN_EXTENSION = 8;
  var PREVIEW_ANCHOR_SIZE_STEP = 2;
  var PREVIEW_ANCHOR_MARGIN_STEP = 2;
  var PREVIEW_ANCHOR_TOP_K = 8;
  var PREVIEW_ANCHOR_MIN_SCORE = 0.2;
  var PREVIEW_ANCHOR_LOCAL_DELTAS = [-1, 0, 1];
  var PREVIEW_TEMPLATE_ALIGN_SHIFTS = [-1, -0.5, 0, 0.5, 1];
  var PREVIEW_TEMPLATE_ALIGN_SCALES = [0.985, 1, 1.015];
  var PREVIEW_ANCHOR_GAIN_SKIP_RESIDUAL_THRESHOLD = 0.24;
  var PREVIEW_ANCHOR_GAIN_SKIP_GRADIENT_THRESHOLD = 0.24;
  var CORE_ALPHA_PRIORITY_GAINS = Object.freeze([0.6, 1, 1.1, 1.15, 1.3, 0.45, 0.7, 0.85, 0.55]);
  var CURRENT_LARGE_MARGIN_ULTRA_WEAK_ALPHA_GAINS = Object.freeze([0.25, 0.3, 0.35, 0.4]);
  var STANDARD_ANCHOR_WEAK_ALPHA_RESCUE_GAINS = Object.freeze([0.55, 0.7, 0.85]);
  var STANDARD_ANCHOR_WEAK_RESCUE_MAX_SPATIAL = 0.35;
  var STANDARD_ANCHOR_WEAK_RESCUE_MAX_GRADIENT = 0.24;
  var STANDARD_ANCHOR_WEAK_RESCUE_MIN_IMPROVEMENT = 0.08;
  var STANDARD_ANCHOR_WEAK_RESCUE_MAX_NEAR_BLACK_INCREASE = 0.02;
  var STANDARD_ANCHOR_WEAK_RESCUE_MIN_BALANCED_ADVANTAGE = 0.03;
  var CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_SPATIAL = 0.22;
  var CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_GRADIENT = 0.36;
  var CURRENT_LARGE_MARGIN_WEAK_RESCUE_MIN_ORIGINAL_SPATIAL = 0.17;
  var CURRENT_LARGE_MARGIN_WEAK_RESCUE_MIN_ORIGINAL_GRADIENT = 0.12;
  var CURRENT_LARGE_MARGIN_WEAK_RESCUE_MIN_IMPROVEMENT = 0.08;
  var CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_NEAR_BLACK_INCREASE = 0.01;
  var CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_TEXTURE = 0.55;
  var CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MIN_ORIGINAL_SPATIAL = 0.4;
  var CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MIN_ORIGINAL_GRADIENT = 0.25;
  var CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MAX_SPATIAL = 0.36;
  var CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MAX_GRADIENT = 0.24;
  var CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MAX_TEXTURE = 0.1;
  var CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MIN_ORIGINAL_SPATIAL = 0.8;
  var CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MIN_ORIGINAL_GRADIENT = 0.8;
  var CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MAX_SPATIAL = 0.35;
  var CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MAX_GRADIENT = 0.18;
  var CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MIN_IMPROVEMENT = 0.7;
  var CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MAX_NEAR_BLACK_INCREASE = 0.05;
  var CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MIN_ORIGINAL_GRADIENT = 0.5;
  var CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_ORIGINAL_SPATIAL = 0.35;
  var CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_ALPHA_GAIN = 0.6;
  var CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_TEXTURE = 0.08;
  var CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_SPATIAL = 0.32;
  var CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MIN_GRADIENT_DROP = 0.12;
  var ORIGIN_REGION = Object.freeze({ x: 0, y: 0 });
  function mergeCandidateProvenance(...provenanceParts) {
    const merged = {};
    for (const provenance of provenanceParts) {
      if (!provenance || typeof provenance !== "object") continue;
      Object.assign(merged, provenance);
    }
    return Object.keys(merged).length > 0 ? merged : null;
  }
  function inferCandidateSourcePriority({ source = "", provenance = null } = {}) {
    const catalogPriority = Number(provenance?.catalogSourcePriority);
    if (Number.isFinite(catalogPriority)) return catalogPriority;
    if (provenance?.localShift === true) return 6;
    if (provenance?.sizeJitter === true) return 7;
    if (provenance?.previewAnchor === true || String(source).includes("preview-anchor")) return 8;
    if (provenance?.adaptive === true || source === "adaptive") return 9;
    if (String(source).startsWith("standard+catalog")) return 3;
    if (String(source).startsWith("standard")) return 0;
    return 9;
  }
  function inferAlphaPriorityIndex(alphaGain) {
    const index = CORE_ALPHA_PRIORITY_GAINS.findIndex((candidateGain) => Math.abs(candidateGain - alphaGain) < 1e-4);
    return index >= 0 ? index : 99;
  }
  function isProjectedPreviewCatalogConfig(originalImageData, candidateConfig, baseConfig) {
    if (!originalImageData || !candidateConfig) return false;
    if (candidateConfig.fixedVariant === true) return false;
    if (matchOfficialGeminiImageSize(originalImageData.width, originalImageData.height)) return false;
    return candidateConfig.logoSize < 48 || candidateConfig.logoSize <= 48 && candidateConfig.marginRight < 32 && candidateConfig.marginBottom < 32;
  }
  function buildStandardCandidateSeeds({
    originalImageData,
    config,
    position,
    alpha48,
    alpha96,
    alpha96Variants = null,
    getAlphaMap,
    resolveAlphaMap = null,
    includeCatalogVariants = true
  }) {
    const catalogEntries = includeCatalogVariants ? resolveGeminiWatermarkSearchCatalogEntries(
      originalImageData.width,
      originalImageData.height,
      config
    ) : [{ config, metadata: null }];
    const seeds = [];
    for (const catalogEntry of catalogEntries) {
      const candidateConfig = catalogEntry.config;
      const candidatePosition = candidateConfig === config ? position : {
        x: originalImageData.width - candidateConfig.marginRight - candidateConfig.logoSize,
        y: originalImageData.height - candidateConfig.marginBottom - candidateConfig.logoSize,
        width: candidateConfig.logoSize,
        height: candidateConfig.logoSize
      };
      if (candidatePosition.x < 0 || candidatePosition.y < 0 || candidatePosition.x + candidatePosition.width > originalImageData.width || candidatePosition.y + candidatePosition.height > originalImageData.height) {
        continue;
      }
      const alphaMap = resolveAlphaMapForConfig(candidateConfig, {
        alpha48,
        alpha96,
        alpha96Variants,
        getAlphaMap,
        resolveAlphaMap
      });
      if (!alphaMap) continue;
      const projectedPreviewCatalog = isProjectedPreviewCatalogConfig(
        originalImageData,
        candidateConfig,
        config
      );
      const baseSeed = {
        config: candidateConfig,
        position: candidatePosition,
        alphaMap,
        source: projectedPreviewCatalog ? "standard+preview-anchor" : candidateConfig === config ? "standard" : "standard+catalog",
        provenance: mergeCandidateProvenance(
          candidateConfig === config ? null : { catalogVariant: true },
          candidateConfig.fixedVariant === true ? { fixedVariant: true } : null,
          projectedPreviewCatalog ? { previewAnchor: true } : null,
          candidateConfig.alphaVariant ? { alphaVariant: candidateConfig.alphaVariant } : null,
          catalogEntry.metadata ? {
            catalogFamily: catalogEntry.metadata.family,
            catalogSourcePriority: catalogEntry.metadata.sourcePriority,
            catalogEvidenceGate: catalogEntry.metadata.evidenceGate
          } : null
        )
      };
      seeds.push(baseSeed);
      if (shouldAddDarkPolaritySeed(candidateConfig)) {
        seeds.push({
          ...baseSeed,
          alphaMap: createNegativeAlphaMap(alphaMap),
          source: `${baseSeed.source}+dark-polarity`,
          provenance: mergeCandidateProvenance(
            baseSeed.provenance,
            { darkPolarity: true }
          )
        });
      }
    }
    return seeds;
  }
  function shouldAddDarkPolaritySeed(config) {
    return config?.logoSize === 96 && config.marginRight === 192 && config.marginBottom === 192;
  }
  var negativeAlphaMapCache = /* @__PURE__ */ new WeakMap();
  function createNegativeAlphaMap(alphaMap) {
    const cached = negativeAlphaMapCache.get(alphaMap);
    if (cached) return cached;
    const negative = new Float32Array(alphaMap.length);
    for (let index = 0; index < alphaMap.length; index++) {
      negative[index] = -alphaMap[index];
    }
    negativeAlphaMapCache.set(alphaMap, negative);
    return negative;
  }
  function inferDecisionTier(candidate, { directMatch = false } = {}) {
    if (!candidate) return "insufficient";
    if (directMatch) return "direct-match";
    if (candidate.source?.includes("validated")) return "validated-match";
    if (candidate.accepted) return "validated-match";
    return "safe-removal";
  }
  function shouldEscalateSearch(candidate) {
    if (!candidate) return true;
    return Math.abs(candidate.processedSpatialScore) > STANDARD_FAST_PATH_RESIDUAL_THRESHOLD || Math.max(0, candidate.processedGradientScore) > STANDARD_FAST_PATH_GRADIENT_THRESHOLD;
  }
  function shouldExpandCatalogForWeakOriginalStandardEvidence(candidate) {
    if (!candidate) return true;
    if (!isStandardCandidateSource(candidate)) return false;
    if (candidate?.provenance?.catalogVariant === true) return false;
    const originalGradient = Number(candidate.originalGradientScore);
    if (!Number.isFinite(originalGradient)) return false;
    return originalGradient < STANDARD_EXPAND_CATALOG_MIN_ORIGINAL_GRADIENT;
  }
  function shouldSearchNearbyStandardCandidate(candidate, originalImageData) {
    if (!candidate) return true;
    return Number(candidate.position?.width) >= 72 && Number(originalImageData?.height) > Number(originalImageData?.width) * 1.25 && (Math.abs(candidate.processedSpatialScore) > STANDARD_NEARBY_SEARCH_RESIDUAL_THRESHOLD || Math.max(0, candidate.processedGradientScore) > STANDARD_NEARBY_SEARCH_GRADIENT_THRESHOLD);
  }
  function resolveAlphaMapForSize(size, { alpha48, alpha96, getAlphaMap } = {}) {
    if (size === 48) return alpha48;
    if (size === 96) return alpha96;
    const provided = typeof getAlphaMap === "function" ? getAlphaMap(size) : null;
    if (provided) return provided;
    return alpha96 ? interpolateAlphaMap(alpha96, 96, size) : null;
  }
  function resolveAlphaMapForConfig(config, {
    alpha48,
    alpha96,
    alpha96Variants = null,
    getAlphaMap,
    resolveAlphaMap = null
  } = {}) {
    if (!config) return null;
    if (config.alphaVariant && config.logoSize === 96 && alpha96Variants) {
      return alpha96Variants[config.alphaVariant] ?? null;
    }
    if (config.alphaVariant && typeof getAlphaMap === "function") {
      const variantAlpha = getAlphaMap(`${config.logoSize}-${config.alphaVariant}`);
      if (variantAlpha) return variantAlpha;
    }
    return typeof resolveAlphaMap === "function" ? resolveAlphaMap(config.logoSize) : resolveAlphaMapForSize(config.logoSize, {
      alpha48,
      alpha96,
      getAlphaMap
    });
  }
  function createAlphaMapResolver({ alpha48, alpha96, getAlphaMap }) {
    const cache = /* @__PURE__ */ new Map();
    return (size) => {
      if (cache.has(size)) {
        return cache.get(size);
      }
      const resolved = resolveAlphaMapForSize(size, {
        alpha48,
        alpha96,
        getAlphaMap
      });
      cache.set(size, resolved);
      return resolved;
    };
  }
  function isPreviewAnchorGainSearchRequired(candidate) {
    if (!candidate) return true;
    return Math.abs(candidate.processedSpatialScore) > PREVIEW_ANCHOR_GAIN_SKIP_RESIDUAL_THRESHOLD || Math.max(0, candidate.processedGradientScore) > PREVIEW_ANCHOR_GAIN_SKIP_GRADIENT_THRESHOLD;
  }
  function isStrictFixedCoreCandidate(candidate) {
    if (!candidate?.accepted) return false;
    const processedSpatial = Number(candidate.processedSpatialScore);
    if (!Number.isFinite(processedSpatial)) return false;
    if (Math.abs(processedSpatial) <= FIXED_CORE_MAX_ACCEPTED_SPATIAL_RESIDUAL) {
      return true;
    }
    const originalSpatial = Number(candidate.originalSpatialScore);
    const originalGradient = Number(candidate.originalGradientScore);
    const processedGradient = Number(candidate.processedGradientScore);
    const improvement = Number(candidate.improvement);
    const texturePenalty = Number(candidate.texturePenalty);
    const nearBlackIncrease = Number(candidate.nearBlackIncrease);
    if (!Number.isFinite(originalSpatial) || !Number.isFinite(originalGradient) || !Number.isFinite(processedGradient) || !Number.isFinite(improvement) || !Number.isFinite(texturePenalty) || !Number.isFinite(nearBlackIncrease)) {
      return false;
    }
    const isStrongStandard96 = candidate.config?.logoSize === 96 && isStandardCandidateSource(candidate) && candidate.provenance?.localShift !== true && candidate.provenance?.sizeJitter !== true && candidate.provenance?.previewAnchor !== true;
    if (!isStrongStandard96 || candidate.hardReject === true) return false;
    const boundedNegativeOvershoot = processedSpatial < 0 && Math.abs(processedSpatial) <= FIXED_CORE_STRONG_96_MAX_NEGATIVE_SPATIAL_RESIDUAL && originalSpatial >= FIXED_CORE_STRONG_96_MIN_ORIGINAL_SPATIAL_SCORE && originalGradient >= FIXED_CORE_STRONG_96_MIN_ORIGINAL_GRADIENT_SCORE && processedGradient <= FIXED_CORE_STRONG_96_MAX_PROCESSED_GRADIENT_SCORE && improvement >= FIXED_CORE_STRONG_96_MIN_IMPROVEMENT && texturePenalty <= FIXED_CORE_STRONG_96_MAX_TEXTURE && nearBlackIncrease <= FIXED_CORE_STRONG_96_MAX_NEAR_BLACK_INCREASE;
    const strongLowResidualFullAnchor = Math.abs(processedSpatial) <= FIXED_CORE_STRONG_96_LOW_RESIDUAL_MAX_SPATIAL_SCORE && processedGradient <= FIXED_CORE_STRONG_96_LOW_RESIDUAL_MAX_GRADIENT_SCORE && originalSpatial >= FIXED_CORE_STRONG_96_LOW_RESIDUAL_MIN_ORIGINAL_SPATIAL_SCORE && originalGradient >= FIXED_CORE_STRONG_96_LOW_RESIDUAL_MIN_ORIGINAL_GRADIENT_SCORE && improvement >= FIXED_CORE_STRONG_96_LOW_RESIDUAL_MIN_IMPROVEMENT && texturePenalty <= FIXED_CORE_STRONG_96_MAX_TEXTURE && nearBlackIncrease <= FIXED_CORE_STRONG_96_MAX_NEAR_BLACK_INCREASE;
    return boundedNegativeOvershoot || strongLowResidualFullAnchor;
  }
  function isCleanWeakAlphaPriorityCandidate(candidate) {
    if (!candidate?.accepted) return false;
    return Math.abs(candidate.processedSpatialScore) <= STANDARD_FAST_PATH_RESIDUAL_THRESHOLD && Math.max(0, candidate.processedGradientScore) <= WEAK_ALPHA_PRIORITY_CLEAN_GRADIENT_THRESHOLD;
  }
  function normalizeAlphaPriorityGains(alphaPriorityGains) {
    const gains = Array.isArray(alphaPriorityGains) && alphaPriorityGains.length > 0 ? alphaPriorityGains : [1];
    const normalized = [];
    const seen = /* @__PURE__ */ new Set();
    for (const gain of gains) {
      if (!Number.isFinite(gain) || gain <= 0) continue;
      const key = gain.toFixed(4);
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(gain);
    }
    if (!seen.has("1.0000")) {
      normalized.push(1);
    }
    return normalized;
  }
  function isWeakAlphaPrioritySeed(seed) {
    return seed?.config?.logoSize === 48 && seed.config.marginRight === 96 && seed.config.marginBottom === 96;
  }
  function resolveStandardSeedAlphaPriorityGains(seed, alphaPriorityGains) {
    const extras = isWeakAlphaPrioritySeed(seed) ? [
      ...CURRENT_LARGE_MARGIN_ULTRA_WEAK_ALPHA_GAINS,
      STANDARD_CONSERVATIVE_CATALOG_PREFERRED_ALPHA_GAIN
    ] : STANDARD_ANCHOR_WEAK_ALPHA_RESCUE_GAINS;
    return normalizeAlphaPriorityGains([
      ...alphaPriorityGains,
      ...extras
    ]);
  }
  function isWeakAlphaRescueCandidate(seed, trial) {
    if (!trial?.accepted || trial.alphaGain >= 1) {
      return false;
    }
    if (isWeakAlphaPrioritySeed(seed)) {
      const isVisibleStrongRescue = trial.originalSpatialScore >= CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MIN_ORIGINAL_SPATIAL && trial.originalGradientScore >= CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MIN_ORIGINAL_GRADIENT && Math.abs(trial.processedSpatialScore) <= CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MAX_SPATIAL && Math.max(0, trial.processedGradientScore) <= CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MAX_GRADIENT && trial.improvement >= CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MIN_IMPROVEMENT && trial.nearBlackIncrease <= CURRENT_LARGE_MARGIN_VISIBLE_RESCUE_MAX_NEAR_BLACK_INCREASE;
      if (isVisibleStrongRescue) {
        return true;
      }
      const isMediumSafeRescue = (trial.originalSpatialScore >= CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MIN_ORIGINAL_SPATIAL || trial.originalGradientScore >= CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MIN_ORIGINAL_GRADIENT) && Math.abs(trial.processedSpatialScore) <= CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MAX_SPATIAL && Math.max(0, trial.processedGradientScore) <= CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MAX_GRADIENT && trial.improvement >= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MIN_IMPROVEMENT && trial.nearBlackIncrease <= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_NEAR_BLACK_INCREASE && trial.texturePenalty <= CURRENT_LARGE_MARGIN_MEDIUM_RESCUE_MAX_TEXTURE && trial.hardReject !== true;
      if (isMediumSafeRescue) {
        return true;
      }
      const hasRescueEvidence = trial.originalSpatialScore >= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MIN_ORIGINAL_SPATIAL || trial.originalGradientScore >= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MIN_ORIGINAL_GRADIENT || trial.originalSpatialScore >= STANDARD_CONSERVATIVE_CATALOG_MIN_ORIGINAL_SPATIAL_SCORE && trial.originalGradientScore >= STANDARD_CONSERVATIVE_CATALOG_MIN_ORIGINAL_GRADIENT_SCORE;
      return hasRescueEvidence && Math.abs(trial.processedSpatialScore) <= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_SPATIAL && Math.max(0, trial.processedGradientScore) <= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_GRADIENT && trial.improvement >= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MIN_IMPROVEMENT && trial.nearBlackIncrease <= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_NEAR_BLACK_INCREASE && trial.texturePenalty <= CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_TEXTURE;
    }
    if (trial.hardReject === true) {
      return false;
    }
    return trial.originalEvidence?.tier === "strong" && Math.abs(trial.processedSpatialScore) <= STANDARD_ANCHOR_WEAK_RESCUE_MAX_SPATIAL && Math.max(0, trial.processedGradientScore) <= STANDARD_ANCHOR_WEAK_RESCUE_MAX_GRADIENT && trial.improvement >= STANDARD_ANCHOR_WEAK_RESCUE_MIN_IMPROVEMENT && trial.nearBlackIncrease <= STANDARD_ANCHOR_WEAK_RESCUE_MAX_NEAR_BLACK_INCREASE && trial.texturePenalty <= 0.25;
  }
  function isStandardTextOverlapWeakAlphaCandidate(seed, trial) {
    if (!trial?.accepted || trial.alphaGain >= 1 || trial.hardReject === true) {
      return false;
    }
    if (seed?.config?.logoSize !== 96 || seed.config.marginRight !== 64 || seed.config.marginBottom !== 64) {
      return false;
    }
    return trial.originalSpatialScore >= STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MIN_ORIGINAL_SPATIAL_SCORE && trial.originalGradientScore >= STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MIN_ORIGINAL_GRADIENT_SCORE && trial.improvement >= STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MIN_IMPROVEMENT && Math.abs(trial.processedSpatialScore) <= STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_SPATIAL_RESIDUAL && Math.max(0, trial.processedGradientScore) <= STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_GRADIENT_RESIDUAL && trial.nearBlackIncrease <= STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_NEAR_BLACK_INCREASE && trial.texturePenalty <= STANDARD_TEXT_OVERLAP_WEAK_ALPHA_MAX_TEXTURE;
  }
  function tagCandidateSource(candidate, tag) {
    if (!candidate || String(candidate.source).includes(tag)) return candidate;
    return {
      ...candidate,
      source: `${candidate.source}+${tag}`
    };
  }
  function shouldPreferLargeMarginGradientClearance(currentBest, candidate) {
    if (!isCurrentLargeMarginCatalogCandidate(currentBest) || !isCurrentLargeMarginCatalogCandidate(candidate)) {
      return false;
    }
    if (currentBest.alphaGain >= 1 || candidate.alphaGain >= 1) {
      return false;
    }
    if (candidate.alphaGain > CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_ALPHA_GAIN) {
      return false;
    }
    if (candidate.originalGradientScore < CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MIN_ORIGINAL_GRADIENT || candidate.originalSpatialScore > CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_ORIGINAL_SPATIAL) {
      return false;
    }
    if (candidate.texturePenalty > CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_TEXTURE || currentBest.texturePenalty > CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_TEXTURE) {
      return false;
    }
    if (Math.abs(candidate.processedSpatialScore) > CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MAX_SPATIAL) {
      return false;
    }
    if (candidate.nearBlackIncrease > CURRENT_LARGE_MARGIN_WEAK_RESCUE_MAX_NEAR_BLACK_INCREASE) {
      return false;
    }
    return Math.max(0, currentBest.processedGradientScore) - Math.max(0, candidate.processedGradientScore) >= CURRENT_LARGE_MARGIN_GRADIENT_CLEAR_MIN_GRADIENT_DROP;
  }
  function pickBetterWeakAlphaRescueCandidate(seed, currentBest, candidate) {
    if (!candidate?.accepted) return currentBest;
    if (!currentBest) return candidate;
    if (isWeakAlphaPrioritySeed(seed) && shouldPreferLargeMarginGradientClearance(currentBest, candidate)) {
      return candidate;
    }
    return pickBetterCandidate(currentBest, candidate, 2e-3);
  }
  function shouldPreferWeakAlphaRescueOverAccepted(acceptedTrial, rescueTrial) {
    if (!acceptedTrial?.accepted || !rescueTrial?.accepted) return false;
    if (rescueTrial.alphaGain >= 1) return false;
    const acceptedCost = Number(acceptedTrial.validationCost);
    const rescueCost = Number(rescueTrial.validationCost);
    if (!Number.isFinite(acceptedCost) || !Number.isFinite(rescueCost)) return false;
    return rescueCost <= acceptedCost - STANDARD_ANCHOR_WEAK_RESCUE_MIN_BALANCED_ADVANTAGE && Math.abs(rescueTrial.processedSpatialScore) <= Math.abs(acceptedTrial.processedSpatialScore) && Math.max(0, rescueTrial.processedGradientScore) <= STANDARD_ANCHOR_WEAK_RESCUE_MAX_GRADIENT && rescueTrial.nearBlackIncrease <= STANDARD_ANCHOR_WEAK_RESCUE_MAX_NEAR_BLACK_INCREASE;
  }
  function evaluateStandardTrialForSeed({
    originalImageData,
    seed,
    alphaPriorityGains
  }) {
    const priorityGains = resolveStandardSeedAlphaPriorityGains(seed, alphaPriorityGains);
    let fallbackTrial = null;
    let bestAcceptedTrial = null;
    let bestWeakAlphaPriorityTrial = null;
    let bestWeakAlphaRescueTrial = null;
    for (const alphaGain of priorityGains) {
      const trial = evaluateRestorationCandidate({
        originalImageData,
        alphaMap: seed.alphaMap,
        position: seed.position,
        source: alphaGain === 1 ? seed.source : `${seed.source}+gain`,
        config: seed.config,
        baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, seed.position),
        alphaGain,
        provenance: seed.provenance,
        includeImageData: false
      });
      if (!trial) continue;
      if (alphaGain === 1 || !fallbackTrial) {
        fallbackTrial = trial;
      }
      if (alphaGain < 1) {
        if (isStandardTextOverlapWeakAlphaCandidate(seed, trial)) {
          bestWeakAlphaPriorityTrial = pickBetterCandidate(
            bestWeakAlphaPriorityTrial,
            tagCandidateSource(trial, "text-overlap"),
            2e-3
          );
        }
        if (isWeakAlphaPrioritySeed(seed) && isCleanWeakAlphaPriorityCandidate(trial) && isWeakAlphaRescueCandidate(seed, trial)) {
          bestWeakAlphaPriorityTrial = pickBetterCandidate(bestWeakAlphaPriorityTrial, trial, 2e-3);
        }
        if (isWeakAlphaRescueCandidate(seed, trial)) {
          bestWeakAlphaRescueTrial = pickBetterWeakAlphaRescueCandidate(seed, bestWeakAlphaRescueTrial, trial);
        }
        continue;
      }
      if (trial.accepted) {
        bestAcceptedTrial = pickBetterCandidate(bestAcceptedTrial, trial, 2e-3);
      }
    }
    return isWeakAlphaPrioritySeed(seed) ? bestWeakAlphaPriorityTrial ?? bestWeakAlphaRescueTrial ?? bestAcceptedTrial ?? fallbackTrial : bestWeakAlphaPriorityTrial ?? (shouldPreferWeakAlphaRescueOverAccepted(bestAcceptedTrial, bestWeakAlphaRescueTrial) ? bestWeakAlphaRescueTrial : bestAcceptedTrial) ?? bestWeakAlphaRescueTrial ?? fallbackTrial;
  }
  function evaluateRestorationCandidate({
    originalImageData,
    alphaMap,
    position,
    source,
    config,
    baselineNearBlackRatio,
    adaptiveConfidence = null,
    alphaGain = 1,
    provenance = null,
    includeImageData = true,
    sourcePriority = null,
    alphaPriorityIndex = null
  }) {
    if (!alphaMap || !position) return null;
    const originalScores = scoreRegion(originalImageData, alphaMap, position);
    const regionImageData = createCandidateRegionImageData({
      originalImageData,
      alphaMap,
      position,
      alphaGain
    });
    const regionPosition = {
      x: ORIGIN_REGION.x,
      y: ORIGIN_REGION.y,
      width: position.width,
      height: position.height
    };
    const processedScores = scoreRegion(regionImageData, alphaMap, regionPosition);
    const nearBlackRatio = calculateNearBlackRatio(regionImageData, regionPosition);
    const nearBlackIncrease = nearBlackRatio - baselineNearBlackRatio;
    const improvement = originalScores.spatialScore - processedScores.spatialScore;
    const gradientIncrease = processedScores.gradientScore - originalScores.gradientScore;
    const textureAssessment = assessReferenceTextureAlignmentFromStats({
      originalImageData,
      referenceImageData: originalImageData,
      candidateTextureStats: getRegionTextureStats(regionImageData, regionPosition),
      position
    });
    const texturePenalty = textureAssessment.texturePenalty;
    const gradientDrop = originalScores.gradientScore - processedScores.gradientScore;
    const strongStandardSignalNearBlackOverride = isStandardCandidateSource({ source }) && alphaGain === 1 && originalScores.spatialScore >= STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_SPATIAL_SCORE && originalScores.gradientScore >= STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_GRADIENT_SCORE && Math.abs(processedScores.spatialScore) <= STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MAX_RESIDUAL && processedScores.gradientScore <= STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MAX_GRADIENT && improvement >= STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_IMPROVEMENT && gradientDrop >= STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MIN_GRADIENT_DROP && nearBlackIncrease <= STANDARD_STRONG_SIGNAL_NEAR_BLACK_OVERRIDE_MAX_NEAR_BLACK_INCREASE;
    const nearBlackIncreaseAllowed = nearBlackIncrease <= MAX_NEAR_BLACK_RATIO_INCREASE2 || strongStandardSignalNearBlackOverride || source === "standard" && originalScores.spatialScore >= STANDARD_TEXT_OVERLAP_MIN_SPATIAL_SCORE && originalScores.gradientScore >= STANDARD_TEXT_OVERLAP_MIN_GRADIENT_SCORE && improvement >= STANDARD_TEXT_OVERLAP_MIN_IMPROVEMENT && Math.abs(processedScores.spatialScore) <= STANDARD_TEXT_OVERLAP_MAX_RESIDUAL && gradientDrop >= STANDARD_TEXT_OVERLAP_MIN_GRADIENT_DROP;
    const hardRejectAllowed = textureAssessment.hardReject !== true || isStandardCandidateSource({ source }) && originalScores.spatialScore >= STANDARD_HARD_REJECT_OVERRIDE_MIN_SPATIAL_SCORE && originalScores.gradientScore >= STANDARD_HARD_REJECT_OVERRIDE_MIN_GRADIENT_SCORE && Math.abs(processedScores.spatialScore) <= STANDARD_HARD_REJECT_OVERRIDE_MAX_RESIDUAL && processedScores.gradientScore <= STANDARD_HARD_REJECT_OVERRIDE_MAX_GRADIENT && improvement >= STANDARD_HARD_REJECT_OVERRIDE_MIN_IMPROVEMENT && nearBlackIncrease <= STANDARD_HARD_REJECT_OVERRIDE_MAX_NEAR_BLACK_INCREASE;
    const conservativeCatalogHardRejectAllowed = textureAssessment.hardReject === true && isCurrentLargeMarginCatalogCandidate({ config, provenance }) && alphaGain <= STANDARD_CONSERVATIVE_CATALOG_MAX_ALPHA_GAIN && originalScores.spatialScore >= STANDARD_CONSERVATIVE_CATALOG_MIN_ORIGINAL_SPATIAL_SCORE && originalScores.gradientScore >= STANDARD_CONSERVATIVE_CATALOG_MIN_ORIGINAL_GRADIENT_SCORE && Math.abs(processedScores.spatialScore) <= STANDARD_CONSERVATIVE_CATALOG_MAX_RESIDUAL && processedScores.gradientScore <= STANDARD_CONSERVATIVE_CATALOG_MAX_GRADIENT && improvement >= STANDARD_CONSERVATIVE_CATALOG_MIN_IMPROVEMENT && nearBlackIncrease <= STANDARD_CONSERVATIVE_CATALOG_MAX_NEAR_BLACK_INCREASE;
    const visibleCatalogHardRejectAllowed = textureAssessment.hardReject === true && isCurrentLargeMarginCatalogCandidate({ config, provenance }) && alphaGain <= STANDARD_VISIBLE_CATALOG_MAX_ALPHA_GAIN && originalScores.spatialScore >= STANDARD_VISIBLE_CATALOG_MIN_ORIGINAL_SPATIAL_SCORE && originalScores.gradientScore >= STANDARD_VISIBLE_CATALOG_MIN_ORIGINAL_GRADIENT_SCORE && Math.abs(processedScores.spatialScore) <= STANDARD_VISIBLE_CATALOG_MAX_SPATIAL_RESIDUAL && processedScores.gradientScore <= STANDARD_VISIBLE_CATALOG_MAX_GRADIENT_RESIDUAL && improvement >= STANDARD_VISIBLE_CATALOG_MIN_IMPROVEMENT && nearBlackIncrease <= STANDARD_VISIBLE_CATALOG_MAX_NEAR_BLACK_INCREASE;
    const newMarginAlphaHardRejectAllowed = textureAssessment.hardReject === true && isNewMarginAlphaVariantTrial({ config, provenance }) && alphaGain === 1 && originalScores.spatialScore >= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_SPATIAL_SCORE && originalScores.gradientScore >= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_GRADIENT_SCORE && Math.abs(processedScores.spatialScore) <= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_RESIDUAL && processedScores.gradientScore <= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_GRADIENT && improvement >= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_IMPROVEMENT && gradientDrop >= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MIN_GRADIENT_DROP && nearBlackIncrease <= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_NEAR_BLACK_INCREASE && texturePenalty <= STANDARD_NEW_MARGIN_ALPHA_OVERRIDE_MAX_TEXTURE;
    const originalEvidenceAllowed = !isStandardCandidateSource({ source }) || originalScores.spatialScore >= STANDARD_VALIDATION_MIN_ORIGINAL_SPATIAL_SCORE || originalScores.gradientScore >= STANDARD_VALIDATION_MIN_ORIGINAL_GRADIENT_SCORE;
    const catalogEvidenceGate = provenance?.catalogEvidenceGate ?? null;
    const catalogEvidenceAllowed = catalogEvidenceGate !== "medium" || originalScores.spatialScore >= 0.15 || originalScores.gradientScore >= 0.08;
    const darkPolarityCatalogEvidenceAllowed = provenance?.darkPolarity !== true || provenance?.catalogVariant !== true || originalScores.spatialScore >= DARK_POLARITY_CATALOG_MIN_ORIGINAL_SPATIAL || originalScores.gradientScore >= DARK_POLARITY_CATALOG_MIN_ORIGINAL_GRADIENT || texturePenalty <= DARK_POLARITY_CATALOG_MAX_TEXTURE_FOR_WEAK_EVIDENCE;
    const baseValidationAccepted = (hardRejectAllowed || conservativeCatalogHardRejectAllowed || visibleCatalogHardRejectAllowed || newMarginAlphaHardRejectAllowed) && nearBlackIncreaseAllowed && improvement >= VALIDATION_MIN_IMPROVEMENT && (Math.abs(processedScores.spatialScore) <= VALIDATION_TARGET_RESIDUAL || gradientIncrease <= VALIDATION_MAX_GRADIENT_INCREASE);
    const mergedProvenance = mergeCandidateProvenance(provenance);
    const resolvedSourcePriority = Number.isFinite(sourcePriority) ? sourcePriority : inferCandidateSourcePriority({ source, provenance: mergedProvenance });
    const resolvedAlphaPriorityIndex = Number.isFinite(alphaPriorityIndex) ? alphaPriorityIndex : inferAlphaPriorityIndex(alphaGain);
    const originalEvidence = scoreOriginalEvidence({
      spatial: originalScores.spatialScore,
      gradient: originalScores.gradientScore
    });
    const residual = scoreResidual({
      processedSpatial: processedScores.spatialScore,
      processedGradient: processedScores.gradientScore,
      suppressionGain: improvement
    });
    const balancedVisual = scoreBalancedVisualCandidate({
      processedSpatial: processedScores.spatialScore,
      processedGradient: processedScores.gradientScore,
      nearBlackIncrease,
      texturePenalty,
      gradientIncrease
    });
    const hardRejectBypassed = conservativeCatalogHardRejectAllowed || visibleCatalogHardRejectAllowed || newMarginAlphaHardRejectAllowed;
    const damage = scoreDamage({
      hardReject: textureAssessment.hardReject === true && !hardRejectBypassed,
      nearBlackIncrease,
      texturePenalty
    });
    const evaluation = createCandidateEvaluation({
      source,
      config,
      provenance: mergedProvenance,
      originalScores,
      processedScores,
      improvement,
      residual,
      damage,
      gates: {
        originalEvidenceAllowed,
        catalogEvidenceAllowed,
        darkPolarityCatalogEvidenceAllowed,
        baseValidationAccepted
      }
    });
    const accepted = evaluation.eligible;
    const rankingKey = buildRankingKey({
      sourcePriority: resolvedSourcePriority,
      originalEvidenceTier: originalEvidence.tier,
      damageSafe: damage.safe,
      residualScore: residual.score,
      alphaPriorityIndex: resolvedAlphaPriorityIndex,
      damagePenalty: damage.penalty
    });
    const earlyAccept = shouldEarlyAccept({
      sourcePriority: resolvedSourcePriority,
      originalEvidence,
      residual,
      damage
    });
    return {
      accepted,
      source,
      config,
      position,
      alphaMap,
      adaptiveConfidence,
      alphaGain,
      sourcePriority: resolvedSourcePriority,
      alphaPriorityIndex: resolvedAlphaPriorityIndex,
      rankingKey,
      earlyAccept,
      provenance: mergedProvenance,
      imageData: includeImageData ? materializeCandidateImageData(originalImageData, alphaMap, position, alphaGain) : null,
      originalSpatialScore: originalScores.spatialScore,
      originalGradientScore: originalScores.gradientScore,
      processedSpatialScore: processedScores.spatialScore,
      processedGradientScore: processedScores.gradientScore,
      improvement,
      nearBlackRatio,
      nearBlackIncrease,
      gradientIncrease,
      tooDark: textureAssessment.tooDark,
      tooFlat: textureAssessment.tooFlat,
      hardReject: textureAssessment.hardReject,
      texturePenalty,
      originalEvidence,
      residual,
      damage,
      evaluation,
      balancedVisual,
      validationCost: balancedVisual.score
    };
  }
  function pickBestValidatedCandidate(candidates) {
    const accepted = candidates.filter((candidate) => candidate?.accepted);
    if (accepted.length === 0) return null;
    accepted.sort((a, b) => {
      if (a.validationCost !== b.validationCost) {
        return a.validationCost - b.validationCost;
      }
      return b.improvement - a.improvement;
    });
    const validationBest = accepted[0];
    const preservedStrongCanonical96 = accepted.find((candidate) => shouldPreserveStrongCanonical96AgainstWeakCurrentLargeMargin(candidate, validationBest));
    return preservedStrongCanonical96 ?? validationBest;
  }
  function pickAggressiveStrongLocatedCandidate(candidates) {
    const located = candidates.filter((candidate) => candidate && isAggressiveLocatedCandidate(candidate)).sort((left, right) => {
      const rightSignal = Number(right.originalSpatialScore) + Math.max(0, Number(right.originalGradientScore)) * 0.75;
      const leftSignal = Number(left.originalSpatialScore) + Math.max(0, Number(left.originalGradientScore)) * 0.75;
      if (rightSignal !== leftSignal) return rightSignal - leftSignal;
      return Number(left.validationCost ?? Infinity) - Number(right.validationCost ?? Infinity);
    });
    return located[0] ?? null;
  }
  function isAggressiveLocatedCandidate(candidate) {
    const spatialScore = Number(candidate.originalSpatialScore);
    const gradientScore = Number(candidate.originalGradientScore);
    if (!Number.isFinite(spatialScore) || !Number.isFinite(gradientScore)) return false;
    const highConfidence = spatialScore >= 0.75 && gradientScore >= 0.5;
    const clearShape = spatialScore >= 0.38 && gradientScore >= -0.06;
    const lowContrastShape = spatialScore >= 0.24 && gradientScore >= 0.02;
    const visibleGradient = spatialScore >= 0.12 && gradientScore >= 0.28;
    return highConfidence || clearShape || lowContrastShape || visibleGradient;
  }
  function createCandidateRegionImageData({
    originalImageData,
    alphaMap,
    position,
    alphaGain
  }) {
    const regionImageData = {
      width: position.width,
      height: position.height,
      data: new Uint8ClampedArray(position.width * position.height * 4)
    };
    for (let row = 0; row < position.height; row++) {
      const srcStart = ((position.y + row) * originalImageData.width + position.x) * 4;
      const srcEnd = srcStart + position.width * 4;
      const destStart = row * position.width * 4;
      regionImageData.data.set(originalImageData.data.subarray(srcStart, srcEnd), destStart);
    }
    removeWatermark(regionImageData, alphaMap, {
      x: 0,
      y: 0,
      width: position.width,
      height: position.height
    }, { alphaGain });
    return regionImageData;
  }
  function materializeCandidateImageData(originalImageData, alphaMap, position, alphaGain) {
    const candidateImageData = cloneImageData(originalImageData);
    removeWatermark(candidateImageData, alphaMap, position, { alphaGain });
    return candidateImageData;
  }
  function ensureCandidateImageData(candidate, originalImageData) {
    if (!candidate) return candidate;
    if (candidate.imageData) return candidate;
    return {
      ...candidate,
      imageData: materializeCandidateImageData(
        originalImageData,
        candidate.alphaMap,
        candidate.position,
        candidate.alphaGain ?? 1
      )
    };
  }
  function sameCandidateAnchor(left, right) {
    if (!left || !right) return false;
    const leftConfig = left.config;
    const rightConfig = right.config;
    const leftPosition = left.position;
    const rightPosition = right.position;
    if (!leftConfig || !rightConfig || !leftPosition || !rightPosition) return false;
    return leftConfig.logoSize === rightConfig.logoSize && leftConfig.marginRight === rightConfig.marginRight && leftConfig.marginBottom === rightConfig.marginBottom && leftPosition.x === rightPosition.x && leftPosition.y === rightPosition.y && leftPosition.width === rightPosition.width && leftPosition.height === rightPosition.height;
  }
  function compareSameAnchorCandidateRanking(currentBest, candidate) {
    if (!sameCandidateAnchor(currentBest, candidate)) return null;
    if (currentBest?.provenance?.previewAnchor === true || candidate?.provenance?.previewAnchor === true) {
      return null;
    }
    if (!Array.isArray(currentBest?.rankingKey) || !Array.isArray(candidate?.rankingKey)) {
      return null;
    }
    return compareRankingKey(candidate.rankingKey, currentBest.rankingKey);
  }
  function pickBetterCandidate(currentBest, candidate, minCostDelta = 5e-3) {
    if (!candidate?.accepted) return currentBest;
    if (!currentBest) return candidate;
    const evaluationDecision = arbitrateCandidateByEvaluation(currentBest, candidate);
    if (evaluationDecision) return evaluationDecision;
    if (shouldPreserveCatalogOriginalSignal(currentBest, candidate)) {
      return currentBest;
    }
    if (shouldPreserveDominantBottomRight48AgainstWeakStandard(currentBest, candidate)) {
      return currentBest;
    }
    if (shouldPreserveDominantBottomRight48AgainstWeakStandard(candidate, currentBest)) {
      return candidate;
    }
    if (shouldPreserveStrongCanonical96AgainstWeakCurrentLargeMargin(currentBest, candidate)) {
      return currentBest;
    }
    if (shouldPreserveStrongCanonical96AgainstWeakCurrentLargeMargin(candidate, currentBest)) {
      return candidate;
    }
    if (shouldPreserveStrongCanonical96AgainstWeakNewMargin(currentBest, candidate)) {
      return currentBest;
    }
    if (shouldPreserveStrongCanonical96AgainstWeakNewMargin(candidate, currentBest)) {
      return candidate;
    }
    if (shouldPreserveStandardAlphaCanonical96AgainstDarkGain(currentBest, candidate)) {
      return currentBest;
    }
    if (shouldPreserveStandardAlphaCanonical96AgainstDarkGain(candidate, currentBest)) {
      return candidate;
    }
    if (shouldPreserveBalancedAlphaCanonical96(currentBest, candidate)) {
      return currentBest;
    }
    if (shouldPreserveBalancedAlphaCanonical96(candidate, currentBest)) {
      return candidate;
    }
    if (shouldPreferCatalogOriginalSignal(candidate, currentBest)) {
      return candidate;
    }
    if (shouldPreserveStrongStandardAnchor(currentBest, candidate)) {
      return currentBest;
    }
    if (shouldPreferPreviewAnchorCandidate(currentBest, candidate)) {
      return candidate;
    }
    if (shouldPreferPreviewAnchorCandidate(candidate, currentBest)) {
      return currentBest;
    }
    const rankingComparison = compareSameAnchorCandidateRanking(currentBest, candidate);
    if (rankingComparison !== null) {
      if (rankingComparison < 0) return candidate;
      if (rankingComparison > 0) return currentBest;
    }
    if (candidate.validationCost < currentBest.validationCost - minCostDelta) {
      return candidate;
    }
    if (Math.abs(candidate.validationCost - currentBest.validationCost) <= minCostDelta && candidate.improvement > currentBest.improvement + 0.01) {
      return candidate;
    }
    return currentBest;
  }
  function isStandardCandidateSource(candidate) {
    return typeof candidate?.source === "string" && candidate.source.startsWith("standard");
  }
  function isDriftedStandardCandidate(candidate) {
    return isStandardCandidateSource(candidate) && (candidate?.provenance?.localShift === true || candidate?.provenance?.sizeJitter === true || candidate?.provenance?.previewAnchor === true || String(candidate?.source || "").includes("+warp"));
  }
  function isCanonicalStandardCandidate(candidate) {
    return isStandardCandidateSource(candidate) && candidate?.provenance?.localShift !== true && candidate?.provenance?.sizeJitter !== true && candidate?.provenance?.previewAnchor !== true;
  }
  function hasStrongCanonicalAnchorSignal(candidate) {
    const baseSpatial = Number(candidate?.originalSpatialScore);
    const baseGradient = Number(candidate?.originalGradientScore);
    if (!Number.isFinite(baseSpatial) || !Number.isFinite(baseGradient)) {
      return false;
    }
    return baseGradient >= STANDARD_LOCAL_SHIFT_CANONICAL_MIN_GRADIENT_SCORE && baseSpatial >= STANDARD_LOCAL_SHIFT_CANONICAL_MIN_SPATIAL_SCORE || baseGradient >= STANDARD_LOCAL_SHIFT_STRONG_BASE_GRADIENT_SCORE || baseSpatial >= STANDARD_LOCAL_SHIFT_STRONG_BASE_SPATIAL_SCORE;
  }
  function hasReliableCandidateOriginalSignal(candidate) {
    return hasReliableStandardWatermarkSignal({
      spatialScore: candidate?.originalSpatialScore,
      gradientScore: candidate?.originalGradientScore
    });
  }
  function hasMuchStrongerOriginalSignal(candidate, otherCandidate) {
    const spatial = Number(candidate?.originalSpatialScore);
    const gradient = Number(candidate?.originalGradientScore);
    const otherSpatial = Number(otherCandidate?.originalSpatialScore);
    const otherGradient = Number(otherCandidate?.originalGradientScore);
    if (!Number.isFinite(spatial) || !Number.isFinite(gradient) || !Number.isFinite(otherSpatial) || !Number.isFinite(otherGradient)) {
      return false;
    }
    return spatial >= otherSpatial + STRONG_ORIGINAL_SIGNAL_SPATIAL_ADVANTAGE && gradient >= otherGradient + STRONG_ORIGINAL_SIGNAL_GRADIENT_ADVANTAGE;
  }
  function isCatalogVariantCandidate(candidate) {
    return candidate?.provenance?.catalogVariant === true;
  }
  function isCurrentLargeMarginCatalogCandidate(candidate) {
    return isCatalogVariantCandidate(candidate) && isCurrentLargeMarginCandidate(candidate);
  }
  function isCurrentLargeMarginCandidate(candidate) {
    return candidate?.config?.logoSize === 48 && candidate.config.marginRight === 96 && candidate.config.marginBottom === 96;
  }
  function isBottomRight48Candidate(candidate) {
    return candidate?.config?.logoSize === 48 && candidate.config.marginRight === 32 && candidate.config.marginBottom === 32 && candidate?.provenance?.localShift !== true && candidate?.provenance?.sizeJitter !== true && candidate?.provenance?.previewAnchor !== true;
  }
  function isWeakCompetingStandardAnchor(candidate) {
    return isStandardCandidateSource(candidate) && candidate?.provenance?.localShift !== true && candidate?.provenance?.sizeJitter !== true && candidate?.provenance?.previewAnchor !== true && !isBottomRight48Candidate(candidate);
  }
  function shouldPreserveDominantBottomRight48AgainstWeakStandard(bottomRightCandidate, competingCandidate) {
    if (!isBottomRight48Candidate(bottomRightCandidate)) return false;
    if (!isWeakCompetingStandardAnchor(competingCandidate)) return false;
    const bottomSpatial = Number(bottomRightCandidate.originalSpatialScore);
    const bottomGradient = Number(bottomRightCandidate.originalGradientScore);
    const largeSpatial = Number(competingCandidate.originalSpatialScore);
    const largeGradient = Number(competingCandidate.originalGradientScore);
    const bottomResidual = Number(bottomRightCandidate.residual?.score);
    const largeResidual = Number(competingCandidate.residual?.score);
    if (!Number.isFinite(bottomSpatial) || !Number.isFinite(bottomGradient) || !Number.isFinite(largeSpatial) || !Number.isFinite(largeGradient) || !Number.isFinite(bottomResidual) || !Number.isFinite(largeResidual)) {
      return false;
    }
    return bottomSpatial >= BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_MIN_SPATIAL && bottomGradient >= BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_MIN_GRADIENT && bottomSpatial >= largeSpatial + BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_SPATIAL_ADVANTAGE && bottomGradient >= largeGradient + BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_GRADIENT_ADVANTAGE && bottomResidual <= largeResidual + BOTTOM_RIGHT_48_EVIDENCE_DOMINANCE_MAX_RESIDUAL_DELTA;
  }
  function shouldPreferCatalogOriginalSignal(candidate, currentBest) {
    if (!isCurrentLargeMarginCandidate(candidate)) return false;
    if (currentBest?.provenance?.localShift === true || currentBest?.provenance?.sizeJitter === true) {
      return false;
    }
    const candidateReliable = hasReliableCandidateOriginalSignal(candidate);
    const currentReliable = hasReliableCandidateOriginalSignal(currentBest);
    if (candidateReliable && !currentReliable) return true;
    return candidateReliable && currentReliable && hasMuchStrongerOriginalSignal(candidate, currentBest);
  }
  function shouldPreserveCatalogOriginalSignal(currentBest, candidate) {
    if (!isCurrentLargeMarginCandidate(currentBest)) return false;
    const currentReliable = hasReliableCandidateOriginalSignal(currentBest);
    const candidateReliable = hasReliableCandidateOriginalSignal(candidate);
    if (currentReliable && !candidateReliable) return true;
    return currentReliable && candidateReliable && hasMuchStrongerOriginalSignal(currentBest, candidate);
  }
  function isCanonicalDefault96Candidate(candidate) {
    return isStandardCandidateSource(candidate) && candidate?.provenance?.catalogVariant !== true && candidate?.provenance?.localShift !== true && candidate?.provenance?.sizeJitter !== true && candidate?.provenance?.previewAnchor !== true && candidate?.config?.logoSize === 96 && candidate.config.marginRight === 64 && candidate.config.marginBottom === 64;
  }
  function isDefault96GeometryCandidate(candidate) {
    return isStandardCandidateSource(candidate) && candidate?.provenance?.localShift !== true && candidate?.provenance?.sizeJitter !== true && candidate?.provenance?.previewAnchor !== true && candidate?.config?.logoSize === 96 && candidate.config.marginRight === 64 && candidate.config.marginBottom === 64;
  }
  function isNewMargin96Candidate2(candidate) {
    return isStandardCandidateSource(candidate) && candidate?.provenance?.localShift !== true && candidate?.provenance?.sizeJitter !== true && candidate?.provenance?.previewAnchor !== true && candidate?.config?.logoSize === 96 && candidate.config.marginRight === 192 && candidate.config.marginBottom === 192;
  }
  function shouldPreserveStrongCanonical96AgainstWeakCurrentLargeMargin(currentBest, candidate) {
    if (!isCanonicalDefault96Candidate(currentBest)) return false;
    if (!isCurrentLargeMarginCatalogCandidate(candidate)) return false;
    const currentSpatial = Number(currentBest.originalSpatialScore);
    const currentGradient = Number(currentBest.originalGradientScore);
    const currentProcessedSpatial = Number(currentBest.processedSpatialScore);
    const currentProcessedGradient = Number(currentBest.processedGradientScore);
    const candidateSpatial = Number(candidate.originalSpatialScore);
    const candidateGradient = Number(candidate.originalGradientScore);
    if (!Number.isFinite(currentSpatial) || !Number.isFinite(currentGradient) || !Number.isFinite(currentProcessedSpatial) || !Number.isFinite(currentProcessedGradient) || !Number.isFinite(candidateSpatial) || !Number.isFinite(candidateGradient)) {
      return false;
    }
    const currentAlreadyCleared = currentBest.residual?.cleared === true;
    const currentStrongLowResidual = currentSpatial >= 0.55 && currentGradient >= 0.5 && Math.abs(currentProcessedSpatial) <= 0.08 && currentProcessedGradient <= 0.24;
    const candidateHasWeakOriginalSignal = candidateGradient < STANDARD_VALIDATION_MIN_ORIGINAL_GRADIENT_SCORE || candidateSpatial <= currentSpatial - 0.2 && candidateGradient <= currentGradient - 0.3;
    return currentSpatial >= 0.4 && currentGradient >= 0.2 && (currentAlreadyCleared || currentStrongLowResidual) && candidateHasWeakOriginalSignal;
  }
  function shouldPreserveStrongCanonical96AgainstWeakNewMargin(currentBest, candidate) {
    if (!isCanonicalDefault96Candidate(currentBest)) return false;
    if (!isNewMargin96Candidate2(candidate)) return false;
    const currentSpatial = Number(currentBest.originalSpatialScore);
    const currentGradient = Number(currentBest.originalGradientScore);
    const candidateSpatial = Number(candidate.originalSpatialScore);
    const candidateGradient = Number(candidate.originalGradientScore);
    if (!Number.isFinite(currentSpatial) || !Number.isFinite(currentGradient) || !Number.isFinite(candidateSpatial) || !Number.isFinite(candidateGradient)) {
      return false;
    }
    const currentHasStrongCanonicalSignal = currentSpatial >= 0.55 && currentGradient >= 0.2;
    const candidateHasStrongNewMarginSignal = candidateSpatial >= 0.55 && candidateGradient >= 0.3;
    const candidateHasWeakOrMuchWeakerSignal = candidateSpatial < STANDARD_VALIDATION_MIN_ORIGINAL_SPATIAL_SCORE || candidateGradient < STANDARD_VALIDATION_MIN_ORIGINAL_GRADIENT_SCORE || candidateSpatial <= currentSpatial - STRONG_ORIGINAL_SIGNAL_SPATIAL_ADVANTAGE && candidateGradient <= currentGradient - STRONG_ORIGINAL_SIGNAL_GRADIENT_ADVANTAGE;
    return currentHasStrongCanonicalSignal && !candidateHasStrongNewMarginSignal && candidateHasWeakOrMuchWeakerSignal;
  }
  function isBalancedCanonical96AlphaGain(candidate) {
    const alphaGain = Number(candidate?.alphaGain);
    return Number.isFinite(alphaGain) && alphaGain >= 1 && alphaGain <= 1.1;
  }
  function shouldPreserveStandardAlphaCanonical96AgainstDarkGain(currentBest, candidate) {
    if (!sameCandidateAnchor(currentBest, candidate)) return false;
    if (!isCanonicalDefault96Candidate(currentBest)) return false;
    const currentAlphaGain = Number(currentBest?.alphaGain);
    const candidateAlphaGain = Number(candidate?.alphaGain);
    if (!Number.isFinite(currentAlphaGain) || !Number.isFinite(candidateAlphaGain) || currentAlphaGain !== 1 || candidateAlphaGain <= 1 || candidate?.tooDark !== true) {
      return false;
    }
    const originalSpatial = Number(currentBest.originalSpatialScore);
    const originalGradient = Number(currentBest.originalGradientScore);
    const currentSpatial = Number(currentBest.processedSpatialScore);
    const currentGradient = Number(currentBest.processedGradientScore);
    if (!Number.isFinite(originalSpatial) || !Number.isFinite(originalGradient) || !Number.isFinite(currentSpatial) || !Number.isFinite(currentGradient)) {
      return false;
    }
    return originalSpatial >= 0.55 && originalGradient >= 0.2 && currentSpatial >= 0 && currentSpatial <= 0.35 && Math.max(0, currentGradient) <= 0.08;
  }
  function shouldPreserveBalancedAlphaCanonical96(currentBest, candidate) {
    if (!sameCandidateAnchor(currentBest, candidate)) return false;
    if (!isCanonicalDefault96Candidate(currentBest)) return false;
    if (!isBalancedCanonical96AlphaGain(currentBest)) return false;
    const candidateAlphaGain = Number(candidate?.alphaGain);
    if (!Number.isFinite(candidateAlphaGain) || candidateAlphaGain <= 1.1) return false;
    const originalSpatial = Number(currentBest.originalSpatialScore);
    const originalGradient = Number(currentBest.originalGradientScore);
    const currentSpatial = Number(currentBest.processedSpatialScore);
    const currentGradient = Number(currentBest.processedGradientScore);
    if (!Number.isFinite(originalSpatial) || !Number.isFinite(originalGradient) || !Number.isFinite(currentSpatial) || !Number.isFinite(currentGradient)) {
      return false;
    }
    return originalSpatial >= 0.55 && originalGradient >= 0.2 && currentSpatial >= 0 && currentSpatial <= 0.22 && Math.max(0, currentGradient) <= 0.1;
  }
  function hasWeakDriftEvidence(candidate) {
    const candidateSpatial = Number(candidate?.originalSpatialScore);
    const candidateGradient = Number(candidate?.originalGradientScore);
    if (!Number.isFinite(candidateSpatial) || !Number.isFinite(candidateGradient)) {
      return false;
    }
    return candidateGradient < STANDARD_LOCAL_SHIFT_WEAK_CANDIDATE_GRADIENT_SCORE || candidateSpatial < STANDARD_LOCAL_SHIFT_WEAK_CANDIDATE_SPATIAL_SCORE;
  }
  function leavesWorseResidualGradientThanCanonical(canonicalCandidate, driftCandidate) {
    const canonicalProcessedGradientRaw = Number(canonicalCandidate?.processedGradientScore);
    const driftProcessedGradientRaw = Number(driftCandidate?.processedGradientScore);
    if (!Number.isFinite(canonicalProcessedGradientRaw) || !Number.isFinite(driftProcessedGradientRaw)) {
      return false;
    }
    return Math.max(0, canonicalProcessedGradientRaw) <= STANDARD_LOCAL_SHIFT_PRESERVE_CLEAN_BASE_GRADIENT_THRESHOLD && Math.max(0, driftProcessedGradientRaw) >= STANDARD_LOCAL_SHIFT_MAX_CANDIDATE_GRADIENT_FOR_CLEAN_BASE;
  }
  function leavesMuchWorseResidualGradientThanCanonical(canonicalCandidate, driftCandidate) {
    const canonicalProcessedSpatial = Number(canonicalCandidate?.processedSpatialScore);
    const canonicalProcessedGradient = Number(canonicalCandidate?.processedGradientScore);
    const canonicalImprovement = Number(canonicalCandidate?.improvement);
    const driftProcessedGradient = Number(driftCandidate?.processedGradientScore);
    if (!Number.isFinite(canonicalProcessedSpatial) || !Number.isFinite(canonicalProcessedGradient) || !Number.isFinite(canonicalImprovement) || !Number.isFinite(driftProcessedGradient)) {
      return false;
    }
    return Math.abs(canonicalProcessedSpatial) <= STANDARD_PRESERVE_MAX_RESIDUAL && canonicalImprovement >= STANDARD_PRESERVE_MIN_IMPROVEMENT && driftProcessedGradient >= canonicalProcessedGradient + STANDARD_PRESERVE_GRADIENT_DELTA;
  }
  function shouldPreserveCanonicalAnchor(canonicalCandidate, driftCandidate) {
    if (!isCanonicalStandardCandidate(canonicalCandidate)) return false;
    if (!isDriftedStandardCandidate(driftCandidate)) return false;
    const validationAdvantage = Number(canonicalCandidate.validationCost) - Number(driftCandidate.validationCost);
    if (!Number.isFinite(validationAdvantage)) {
      return false;
    }
    return hasStrongCanonicalAnchorSignal(canonicalCandidate) && hasWeakDriftEvidence(driftCandidate) && validationAdvantage < STANDARD_LOCAL_SHIFT_MIN_VALIDATION_ADVANTAGE || leavesWorseResidualGradientThanCanonical(canonicalCandidate, driftCandidate) || leavesMuchWorseResidualGradientThanCanonical(canonicalCandidate, driftCandidate);
  }
  function shouldPreserveStrongStandardAnchor(currentBest, candidate) {
    if (currentBest?.provenance?.localShift === true) return false;
    if (!isStandardCandidateSource(candidate)) return false;
    return shouldPreserveCanonicalAnchor(currentBest, candidate);
  }
  function shouldRevertLocalShiftToStandardTrial(selectedCandidate, standardTrial) {
    if (selectedCandidate?.provenance?.localShift !== true) return false;
    if (!isStandardCandidateSource(selectedCandidate) || !isStandardCandidateSource(standardTrial)) return false;
    if (!standardTrial?.accepted) return false;
    return shouldPreserveCanonicalAnchor(standardTrial, selectedCandidate);
  }
  function shouldSkipStandardLocalSearch(seedCandidate) {
    if (!seedCandidate) return false;
    return Math.max(0, Number(seedCandidate.processedGradientScore)) <= STANDARD_LOCAL_SHIFT_SKIP_PROCESSED_GRADIENT_THRESHOLD;
  }
  function isPreviewAnchorSearchEligible(originalImageData, config) {
    if (!config || config.logoSize !== 48) return false;
    const width = Number(originalImageData?.width);
    const height = Number(originalImageData?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
    if (width < 384 || width > 1536) return false;
    if (height < 384 || height > 1536) return false;
    if (Math.max(width, height) < 512) return false;
    return matchOfficialGeminiImageSize(width, height) === null;
  }
  function shouldPreferPreviewAnchorCandidate(currentBest, candidate) {
    if (candidate?.provenance?.previewAnchor !== true) return false;
    if (!currentBest || currentBest?.provenance?.previewAnchor === true) return false;
    const currentSpatial = Number(currentBest.originalSpatialScore);
    const currentGradient = Number(currentBest.originalGradientScore);
    const candidateSpatial = Number(candidate.originalSpatialScore);
    const candidateGradient = Number(candidate.originalGradientScore);
    if (!Number.isFinite(currentSpatial) || !Number.isFinite(currentGradient) || !Number.isFinite(candidateSpatial) || !Number.isFinite(candidateGradient)) {
      return false;
    }
    const currentReliable = hasReliableStandardWatermarkSignal({
      spatialScore: currentSpatial,
      gradientScore: currentGradient
    });
    const candidateReliable = hasReliableStandardWatermarkSignal({
      spatialScore: candidateSpatial,
      gradientScore: candidateGradient
    });
    if (candidateReliable && !currentReliable) {
      return true;
    }
    return candidateGradient >= currentGradient + 0.2 && candidateSpatial >= currentSpatial + 0.05;
  }
  function findBestTemplateWarp({
    originalImageData,
    alphaMap,
    position,
    baselineSpatialScore,
    baselineGradientScore,
    shiftCandidates = TEMPLATE_ALIGN_SHIFTS,
    scaleCandidates = TEMPLATE_ALIGN_SCALES
  }) {
    const size = position.width;
    if (!size || size <= 8) return null;
    let best = {
      spatialScore: baselineSpatialScore,
      gradientScore: baselineGradientScore,
      shift: { dx: 0, dy: 0, scale: 1 },
      alphaMap
    };
    for (const scale of scaleCandidates) {
      for (const dy of shiftCandidates) {
        for (const dx of shiftCandidates) {
          if (dx === 0 && dy === 0 && scale === 1) continue;
          const warped = warpAlphaMap(alphaMap, size, { dx, dy, scale });
          const spatialScore = computeRegionSpatialCorrelation({
            imageData: originalImageData,
            alphaMap: warped,
            region: { x: position.x, y: position.y, size }
          });
          const gradientScore = computeRegionGradientCorrelation({
            imageData: originalImageData,
            alphaMap: warped,
            region: { x: position.x, y: position.y, size }
          });
          const confidence = Math.max(0, spatialScore) * 0.7 + Math.max(0, gradientScore) * 0.3;
          const bestConfidence = Math.max(0, best.spatialScore) * 0.7 + Math.max(0, best.gradientScore) * 0.3;
          if (confidence > bestConfidence + 0.01) {
            best = {
              spatialScore,
              gradientScore,
              shift: { dx, dy, scale },
              alphaMap: warped
            };
          }
        }
      }
    }
    const improvedSpatial = best.spatialScore >= baselineSpatialScore + 0.01;
    const improvedGradient = best.gradientScore >= baselineGradientScore + 0.01;
    return improvedSpatial || improvedGradient ? best : null;
  }
  function searchNearbyStandardCandidate({
    originalImageData,
    candidateSeeds,
    adaptiveConfidence = null
  }) {
    if (!Array.isArray(candidateSeeds) || candidateSeeds.length === 0) return null;
    let bestCandidate = null;
    for (const seed of candidateSeeds) {
      if (shouldSkipStandardLocalSearch(seed)) continue;
      for (const dy of STANDARD_NEARBY_SHIFTS) {
        for (const dx of STANDARD_NEARBY_SHIFTS) {
          if (dx === 0 && dy === 0) continue;
          const candidatePosition = {
            x: seed.position.x + dx,
            y: seed.position.y + dy,
            width: seed.position.width,
            height: seed.position.height
          };
          if (candidatePosition.x < 0 || candidatePosition.y < 0) continue;
          if (candidatePosition.x + candidatePosition.width > originalImageData.width) continue;
          if (candidatePosition.y + candidatePosition.height > originalImageData.height) continue;
          const candidate = evaluateRestorationCandidate({
            originalImageData,
            alphaMap: seed.alphaMap,
            position: candidatePosition,
            source: `${seed.source}+local`,
            config: seed.config,
            baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, candidatePosition),
            adaptiveConfidence,
            provenance: mergeCandidateProvenance(seed.provenance, { localShift: true }),
            includeImageData: false
          });
          if (!candidate?.accepted) continue;
          bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
        }
      }
    }
    return bestCandidate;
  }
  function searchStandardSizeJitterCandidate({
    originalImageData,
    candidateSeeds,
    alpha48,
    alpha96,
    getAlphaMap,
    resolveAlphaMap = null,
    adaptiveConfidence = null
  }) {
    if (!Array.isArray(candidateSeeds) || candidateSeeds.length === 0) return null;
    let bestCandidate = null;
    for (const seed of candidateSeeds) {
      for (const delta of STANDARD_SIZE_JITTERS) {
        const size = seed.position.width + delta;
        if (size <= 24) continue;
        if (size === seed.position.width) continue;
        const candidatePosition = {
          x: originalImageData.width - seed.config.marginRight - size,
          y: originalImageData.height - seed.config.marginBottom - size,
          width: size,
          height: size
        };
        if (candidatePosition.x < 0 || candidatePosition.y < 0) continue;
        if (candidatePosition.x + candidatePosition.width > originalImageData.width) continue;
        if (candidatePosition.y + candidatePosition.height > originalImageData.height) continue;
        const candidateAlphaMap = typeof resolveAlphaMap === "function" ? resolveAlphaMap(size) : resolveAlphaMapForSize(size, {
          alpha48,
          alpha96,
          getAlphaMap
        });
        if (!candidateAlphaMap) continue;
        const candidate = evaluateRestorationCandidate({
          originalImageData,
          alphaMap: candidateAlphaMap,
          position: candidatePosition,
          source: `${seed.source}+size`,
          config: {
            logoSize: size,
            marginRight: seed.config.marginRight,
            marginBottom: seed.config.marginBottom
          },
          baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, candidatePosition),
          adaptiveConfidence,
          provenance: mergeCandidateProvenance(seed.provenance, { sizeJitter: true }),
          includeImageData: false
        });
        if (!candidate?.accepted) continue;
        bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
      }
    }
    return bestCandidate;
  }
  function searchFineStandardLocalCandidate({
    originalImageData,
    seedCandidate,
    adaptiveConfidence = null,
    shiftCandidates = STANDARD_FINE_LOCAL_SHIFTS
  }) {
    if (!seedCandidate?.alphaMap || !seedCandidate?.position) return null;
    if (shouldSkipStandardLocalSearch(seedCandidate)) return null;
    let bestCandidate = null;
    for (const dy of shiftCandidates) {
      for (const dx of shiftCandidates) {
        if (dx === 0 && dy === 0) continue;
        const candidatePosition = {
          x: seedCandidate.position.x + dx,
          y: seedCandidate.position.y + dy,
          width: seedCandidate.position.width,
          height: seedCandidate.position.height
        };
        if (candidatePosition.x < 0 || candidatePosition.y < 0) continue;
        if (candidatePosition.x + candidatePosition.width > originalImageData.width) continue;
        if (candidatePosition.y + candidatePosition.height > originalImageData.height) continue;
        const candidate = evaluateRestorationCandidate({
          originalImageData,
          alphaMap: seedCandidate.alphaMap,
          position: candidatePosition,
          source: `${seedCandidate.source}+local`,
          config: seedCandidate.config,
          baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, candidatePosition),
          adaptiveConfidence,
          provenance: mergeCandidateProvenance(seedCandidate.provenance, { localShift: true }),
          includeImageData: false
        });
        if (!candidate?.accepted) continue;
        bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
      }
    }
    return bestCandidate;
  }
  function searchCandidateAlphaGain({
    originalImageData,
    seedCandidate,
    adaptiveConfidence = null,
    alphaGainCandidates = []
  }) {
    if (!seedCandidate?.alphaMap || !seedCandidate?.position) return null;
    let bestCandidate = null;
    for (const candidateGain of alphaGainCandidates) {
      if (!Number.isFinite(candidateGain) || candidateGain <= 0 || candidateGain === 1) continue;
      const candidate = evaluateRestorationCandidate({
        originalImageData,
        alphaMap: seedCandidate.alphaMap,
        position: seedCandidate.position,
        source: `${seedCandidate.source}+gain`,
        config: seedCandidate.config,
        baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, seedCandidate.position),
        adaptiveConfidence,
        alphaGain: candidateGain,
        provenance: seedCandidate.provenance,
        includeImageData: false
      });
      if (!candidate?.accepted) continue;
      if (candidateGain < 1 && (candidate.improvement < STANDARD_PRESERVE_MIN_IMPROVEMENT || Math.abs(candidate.processedSpatialScore) > VALIDATION_TARGET_RESIDUAL)) {
        continue;
      }
      bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
    }
    return bestCandidate;
  }
  function searchBestEffortCurrentLargeMarginWeakAlpha({
    originalImageData,
    standardTrials,
    alphaGainCandidates
  }) {
    let bestCandidate = null;
    for (const seedCandidate of standardTrials) {
      if (!isCurrentLargeMarginCatalogCandidate(seedCandidate)) continue;
      if (!hasReliableCandidateOriginalSignal(seedCandidate)) continue;
      for (const candidateGain of alphaGainCandidates) {
        if (!Number.isFinite(candidateGain) || candidateGain <= 0 || candidateGain >= 1) continue;
        const candidate = evaluateRestorationCandidate({
          originalImageData,
          alphaMap: seedCandidate.alphaMap,
          position: seedCandidate.position,
          source: `${seedCandidate.source}+validated+gain`,
          config: seedCandidate.config,
          baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, seedCandidate.position),
          alphaGain: candidateGain,
          provenance: seedCandidate.provenance,
          includeImageData: false
        });
        if (!candidate?.accepted) continue;
        bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
      }
    }
    return bestCandidate;
  }
  function hasFixedCoreLocalOriginalEvidence({
    seed,
    sizeDelta,
    marginRightDelta,
    marginBottomDelta,
    originalScores
  }) {
    if (originalScores.spatialScore >= FIXED_CORE_LOCAL_MIN_ORIGINAL_SPATIAL_SCORE && originalScores.gradientScore >= FIXED_CORE_LOCAL_MIN_ORIGINAL_GRADIENT_SCORE) {
      return true;
    }
    return seed?.provenance?.sampleDerivedRescueSeed === true && sizeDelta === 0 && marginRightDelta === 0 && marginBottomDelta === 0 && originalScores.spatialScore >= FIXED_CORE_LOCAL_VISIBLE_CATALOG_MIN_ORIGINAL_SPATIAL_SCORE && originalScores.gradientScore >= FIXED_CORE_LOCAL_VISIBLE_CATALOG_MIN_ORIGINAL_GRADIENT_SCORE;
  }
  function searchFixedCoreLocalGeometryCandidate({
    originalImageData,
    candidateSeeds,
    resolveAlphaMap,
    alphaGainCandidates
  }) {
    let bestCandidate = null;
    const localSeeds = [...Array.isArray(candidateSeeds) ? candidateSeeds : []];
    if (!localSeeds.some((seed) => seed?.provenance?.sampleDerivedRescueSeed === true)) {
      const position = {
        x: originalImageData.width - 96 - 48,
        y: originalImageData.height - 96 - 48,
        width: 48,
        height: 48
      };
      if (position.x >= 0 && position.y >= 0 && position.x + position.width <= originalImageData.width && position.y + position.height <= originalImageData.height) {
        localSeeds.push({
          config: { logoSize: 48, marginRight: 96, marginBottom: 96 },
          position,
          alphaMap: resolveAlphaMap(48),
          source: "standard+catalog",
          provenance: { catalogVariant: true, sampleDerivedRescueSeed: true }
        });
      }
    }
    for (const seed of localSeeds) {
      if (seed?.config?.logoSize !== 48) continue;
      const restrictToExactCatalogAnchor = seed?.provenance?.sampleDerivedRescueSeed !== true && isCurrentLargeMarginCatalogCandidate(seed);
      for (const sizeDelta of FIXED_CORE_LOCAL_SIZE_DELTAS) {
        if (restrictToExactCatalogAnchor && sizeDelta !== 0) continue;
        const size = seed.config.logoSize + sizeDelta;
        if (size < 40 || size > 56) continue;
        const alphaMap = resolveAlphaMap(size);
        if (!alphaMap) continue;
        for (const marginRightDelta of FIXED_CORE_LOCAL_MARGIN_DELTAS) {
          if (restrictToExactCatalogAnchor && marginRightDelta !== 0) continue;
          const marginRight = seed.config.marginRight + marginRightDelta;
          if (marginRight < 0) continue;
          for (const marginBottomDelta of FIXED_CORE_LOCAL_MARGIN_DELTAS) {
            if (restrictToExactCatalogAnchor && marginBottomDelta !== 0) continue;
            const marginBottom = seed.config.marginBottom + marginBottomDelta;
            if (marginBottom < 0) continue;
            const position = {
              x: originalImageData.width - marginRight - size,
              y: originalImageData.height - marginBottom - size,
              width: size,
              height: size
            };
            if (position.x < 0 || position.y < 0) continue;
            if (position.x + position.width > originalImageData.width) continue;
            if (position.y + position.height > originalImageData.height) continue;
            const originalScores = scoreRegion(originalImageData, alphaMap, position);
            if (!hasFixedCoreLocalOriginalEvidence({
              seed,
              sizeDelta,
              marginRightDelta,
              marginBottomDelta,
              originalScores
            })) {
              continue;
            }
            for (const alphaGain of alphaGainCandidates) {
              if (!Number.isFinite(alphaGain) || alphaGain <= 0) continue;
              const candidate = evaluateRestorationCandidate({
                originalImageData,
                alphaMap,
                position,
                source: alphaGain === 1 ? `${seed.source}+fixed-local` : `${seed.source}+fixed-local+gain`,
                config: {
                  logoSize: size,
                  marginRight,
                  marginBottom
                },
                baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, position),
                alphaGain,
                provenance: mergeCandidateProvenance(seed.provenance, {
                  fixedCoreLocalGeometry: true,
                  localShift: marginRightDelta !== 0 || marginBottomDelta !== 0,
                  sizeJitter: sizeDelta !== 0
                }),
                includeImageData: false
              });
              if (!candidate?.accepted) continue;
              if (!isStrictFixedCoreCandidate(candidate)) continue;
              bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
            }
          }
        }
      }
    }
    return bestCandidate;
  }
  function searchStrongStandardTrialAlphaGain({
    originalImageData,
    standardTrials,
    standardTrial,
    baseCandidate,
    baseDecisionTier,
    alphaGainCandidates
  }) {
    let nextBaseCandidate = baseCandidate;
    let nextBaseDecisionTier = baseDecisionTier;
    for (const candidate of standardTrials) {
      if (!candidate || candidate.accepted) continue;
      if (candidate === standardTrial && nextBaseCandidate) continue;
      const reliableMatch = hasReliableStandardWatermarkSignal({
        spatialScore: candidate.originalSpatialScore,
        gradientScore: candidate.originalGradientScore
      });
      if (!reliableMatch) continue;
      const gainedCandidate = searchCandidateAlphaGain({
        originalImageData,
        seedCandidate: {
          ...candidate,
          source: `${candidate.source}+validated`
        },
        adaptiveConfidence: null,
        alphaGainCandidates
      });
      if (!gainedCandidate) continue;
      ({
        baseCandidate: nextBaseCandidate,
        baseDecisionTier: nextBaseDecisionTier
      } = promoteBaseCandidate(nextBaseCandidate, nextBaseDecisionTier, gainedCandidate, {
        reliableMatch,
        minCostDelta: 2e-3
      }));
    }
    return {
      baseCandidate: nextBaseCandidate,
      baseDecisionTier: nextBaseDecisionTier
    };
  }
  function searchFixedCoreStrongStandardAlphaGain({
    originalImageData,
    baseCandidate,
    alphaGainCandidates
  }) {
    if (!isCanonicalDefault96Candidate(baseCandidate)) return null;
    if (!hasReliableCandidateOriginalSignal(baseCandidate)) return null;
    let bestCandidate = null;
    const baselineNearBlackRatio = calculateNearBlackRatio(originalImageData, baseCandidate.position);
    for (const candidateGain of alphaGainCandidates) {
      if (!Number.isFinite(candidateGain) || candidateGain <= 0 || candidateGain === 1) continue;
      const candidate = evaluateRestorationCandidate({
        originalImageData,
        alphaMap: baseCandidate.alphaMap,
        position: baseCandidate.position,
        source: `${baseCandidate.source}+gain`,
        config: baseCandidate.config,
        baselineNearBlackRatio,
        alphaGain: candidateGain,
        provenance: baseCandidate.provenance,
        includeImageData: false
      });
      if (!candidate?.accepted || !isStrictFixedCoreCandidate(candidate)) continue;
      bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
    }
    return bestCandidate;
  }
  function createDefaultAlphaRescueProvenance(provenance) {
    const {
      alphaVariant,
      ...baseProvenance
    } = provenance ?? {};
    return mergeCandidateProvenance(baseProvenance, {
      defaultAlphaVariantRescue: true
    });
  }
  function searchDefaultAlphaNewMarginRescue({
    originalImageData,
    standardTrials,
    alpha96,
    alphaGainCandidates
  }) {
    if (!alpha96) return null;
    let bestCandidate = null;
    const rescueGains = normalizeAlphaPriorityGains([
      ...alphaGainCandidates,
      ...STANDARD_ANCHOR_WEAK_ALPHA_RESCUE_GAINS
    ]);
    for (const seedCandidate of standardTrials) {
      if (!isNewMarginAlphaVariantTrial(seedCandidate)) continue;
      if (seedCandidate.provenance?.darkPolarity === true) continue;
      const config = {
        logoSize: 96,
        marginRight: 192,
        marginBottom: 192
      };
      const provenance = createDefaultAlphaRescueProvenance(seedCandidate.provenance);
      const baselineNearBlackRatio = calculateNearBlackRatio(originalImageData, seedCandidate.position);
      for (const alphaGain of rescueGains) {
        if (!Number.isFinite(alphaGain) || alphaGain <= 0) continue;
        const candidate = evaluateRestorationCandidate({
          originalImageData,
          alphaMap: alpha96,
          position: seedCandidate.position,
          source: alphaGain === 1 ? `${seedCandidate.source}+default-alpha` : `${seedCandidate.source}+default-alpha+gain`,
          config,
          baselineNearBlackRatio,
          alphaGain,
          provenance,
          includeImageData: false
        });
        if (!candidate?.accepted) continue;
        if (!hasSafeDefaultAlphaNewMarginResidual(candidate)) continue;
        bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
      }
    }
    return bestCandidate;
  }
  function insertTopPreviewCandidate(topCandidates, candidate) {
    topCandidates.push(candidate);
    topCandidates.sort((a, b) => b.coarseScore - a.coarseScore);
    if (topCandidates.length > PREVIEW_ANCHOR_TOP_K) {
      topCandidates.length = PREVIEW_ANCHOR_TOP_K;
    }
  }
  function searchBottomRightPreviewCandidate({
    originalImageData,
    config,
    alpha48,
    alpha96,
    getAlphaMap,
    resolveAlphaMap = null,
    adaptiveConfidence = null
  }) {
    if (!isPreviewAnchorSearchEligible(originalImageData, config)) return null;
    const minSize = Math.max(
      PREVIEW_ANCHOR_MIN_SIZE,
      Math.round(config.logoSize * PREVIEW_ANCHOR_MIN_SIZE_RATIO)
    );
    const maxSize = Math.max(
      minSize,
      Math.round(config.logoSize * PREVIEW_ANCHOR_MAX_SIZE_RATIO)
    );
    const minMarginRight = Math.max(8, config.marginRight - PREVIEW_ANCHOR_MARGIN_WINDOW);
    const maxMarginRight = config.marginRight + PREVIEW_ANCHOR_MARGIN_EXTENSION;
    const minMarginBottom = Math.max(8, config.marginBottom - PREVIEW_ANCHOR_MARGIN_WINDOW);
    const maxMarginBottom = config.marginBottom + PREVIEW_ANCHOR_MARGIN_EXTENSION;
    const topCandidates = [];
    for (let size = minSize; size <= maxSize; size += PREVIEW_ANCHOR_SIZE_STEP) {
      const alphaMap = typeof resolveAlphaMap === "function" ? resolveAlphaMap(size) : resolveAlphaMapForSize(size, {
        alpha48,
        alpha96,
        getAlphaMap
      });
      if (!alphaMap) continue;
      for (let marginRight = minMarginRight; marginRight <= maxMarginRight; marginRight += PREVIEW_ANCHOR_MARGIN_STEP) {
        const x = originalImageData.width - marginRight - size;
        if (x < 0 || x + size > originalImageData.width) continue;
        for (let marginBottom = minMarginBottom; marginBottom <= maxMarginBottom; marginBottom += PREVIEW_ANCHOR_MARGIN_STEP) {
          const y = originalImageData.height - marginBottom - size;
          if (y < 0 || y + size > originalImageData.height) continue;
          const coarseSpatialScore = computeRegionSpatialCorrelation({
            imageData: originalImageData,
            alphaMap,
            region: { x, y, size }
          });
          const coarseGradientScore = computeRegionGradientCorrelation({
            imageData: originalImageData,
            alphaMap,
            region: { x, y, size }
          });
          const coarseScore = Math.max(0, coarseGradientScore) * 0.6 + Math.max(0, coarseSpatialScore) * 0.4;
          if (coarseScore < PREVIEW_ANCHOR_MIN_SCORE) continue;
          insertTopPreviewCandidate(topCandidates, {
            coarseScore,
            alphaMap,
            position: { x, y, width: size, height: size },
            config: {
              logoSize: size,
              marginRight,
              marginBottom
            }
          });
        }
      }
    }
    let bestCandidate = null;
    for (const coarseCandidate of topCandidates) {
      for (const sizeDelta of PREVIEW_ANCHOR_LOCAL_DELTAS) {
        const size = coarseCandidate.position.width + sizeDelta;
        if (size < PREVIEW_ANCHOR_MIN_SIZE) continue;
        const alphaMap = typeof resolveAlphaMap === "function" ? resolveAlphaMap(size) : resolveAlphaMapForSize(size, {
          alpha48,
          alpha96,
          getAlphaMap
        });
        if (!alphaMap) continue;
        for (const dx of PREVIEW_ANCHOR_LOCAL_DELTAS) {
          for (const dy of PREVIEW_ANCHOR_LOCAL_DELTAS) {
            const position = {
              x: coarseCandidate.position.x + dx,
              y: coarseCandidate.position.y + dy,
              width: size,
              height: size
            };
            if (position.x < 0 || position.y < 0) continue;
            if (position.x + position.width > originalImageData.width) continue;
            if (position.y + position.height > originalImageData.height) continue;
            const config2 = {
              logoSize: size,
              marginRight: originalImageData.width - position.x - size,
              marginBottom: originalImageData.height - position.y - size
            };
            const candidate = evaluateRestorationCandidate({
              originalImageData,
              alphaMap,
              position,
              source: "standard+preview-anchor",
              config: config2,
              baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, position),
              adaptiveConfidence,
              provenance: {
                previewAnchor: true,
                previewAnchorLocalRefine: sizeDelta !== 0 || dx !== 0 || dy !== 0
              },
              includeImageData: false
            });
            if (!candidate?.accepted) continue;
            bestCandidate = pickBetterCandidate(bestCandidate, candidate, 2e-3);
          }
        }
      }
    }
    return bestCandidate;
  }
  function evaluateStandardTrialsForSeeds({
    originalImageData,
    candidateSeeds,
    alphaPriorityGains = [1]
  }) {
    const standardTrials = candidateSeeds.map((seed) => evaluateStandardTrialForSeed({
      originalImageData,
      seed,
      alphaPriorityGains
    })).filter(Boolean);
    const standardTrial = standardTrials.find((candidate) => candidate.source === "standard") ?? standardTrials[0] ?? null;
    const standardSpatialScore = standardTrial?.originalSpatialScore ?? null;
    const standardGradientScore = standardTrial?.originalGradientScore ?? null;
    const hasReliableStandardMatch = hasReliableStandardWatermarkSignal({
      spatialScore: standardSpatialScore,
      gradientScore: standardGradientScore
    });
    return {
      standardTrials,
      standardTrial,
      standardSpatialScore,
      standardGradientScore,
      hasReliableStandardMatch
    };
  }
  function resolveStandardAnchorSelection({
    originalImageData,
    config,
    position,
    alpha48,
    alpha96,
    alpha96Variants,
    getAlphaMap,
    resolveAlphaMap,
    alphaPriorityGains,
    forceCatalogVariants = false
  }) {
    let standardCandidateSeeds = buildStandardCandidateSeeds({
      originalImageData,
      config,
      position,
      alpha48,
      alpha96,
      alpha96Variants,
      getAlphaMap,
      resolveAlphaMap,
      includeCatalogVariants: false
    });
    let standardSelection = evaluateStandardTrialsForSeeds({
      originalImageData,
      candidateSeeds: standardCandidateSeeds,
      alphaPriorityGains
    });
    const shouldSearchCatalogRescue = standardSelection.standardTrial && !standardSelection.standardTrial.accepted && shouldEscalateSearch(standardSelection.standardTrial);
    const shouldExpandStandardCatalog = forceCatalogVariants || shouldSearchCatalogRescue || !standardSelection.hasReliableStandardMatch && (!standardSelection.standardTrial || shouldEscalateSearch(standardSelection.standardTrial) || matchOfficialGeminiImageSize(originalImageData.width, originalImageData.height) === null && shouldExpandCatalogForWeakOriginalStandardEvidence(standardSelection.standardTrial));
    if (shouldExpandStandardCatalog) {
      standardCandidateSeeds = buildStandardCandidateSeeds({
        originalImageData,
        config,
        position,
        alpha48,
        alpha96,
        alpha96Variants,
        getAlphaMap,
        resolveAlphaMap,
        includeCatalogVariants: true
      });
      standardSelection = evaluateStandardTrialsForSeeds({
        originalImageData,
        candidateSeeds: standardCandidateSeeds,
        alphaPriorityGains
      });
    }
    return {
      standardCandidateSeeds,
      ...standardSelection
    };
  }
  function resolveCandidatePromotion(candidate, {
    reliableMatch = false
  } = {}) {
    if (!candidate?.accepted) {
      return null;
    }
    if (reliableMatch) {
      return {
        candidate,
        decisionTier: "direct-match"
      };
    }
    return {
      candidate: {
        ...candidate,
        source: `${candidate.source}+validated`
      },
      decisionTier: "validated-match"
    };
  }
  function promoteBaseCandidate(baseCandidate, baseDecisionTier, candidate, {
    reliableMatch = false,
    minCostDelta = 2e-3
  } = {}) {
    const promotion = resolveCandidatePromotion(candidate, {
      reliableMatch
    });
    if (!promotion) {
      return {
        baseCandidate,
        baseDecisionTier
      };
    }
    if (shouldPreserveCanonicalAnchor(baseCandidate, promotion.candidate)) {
      return {
        baseCandidate,
        baseDecisionTier
      };
    }
    if (reliableMatch && shouldPreferCatalogOriginalSignal(promotion.candidate, baseCandidate)) {
      return {
        baseCandidate: promotion.candidate,
        baseDecisionTier: promotion.decisionTier
      };
    }
    const previousCandidate = baseCandidate;
    const nextCandidate = pickBetterCandidate(baseCandidate, promotion.candidate, minCostDelta);
    return {
      baseCandidate: nextCandidate,
      baseDecisionTier: nextCandidate !== previousCandidate ? promotion.decisionTier : baseDecisionTier
    };
  }
  function evaluateAdaptiveTrial({
    originalImageData,
    config,
    alpha96,
    resolveAlphaMap,
    allowAdaptiveSearch
  }) {
    if (!allowAdaptiveSearch || !alpha96) {
      return {
        adaptive: null,
        adaptiveConfidence: null,
        adaptiveTrial: null
      };
    }
    const adaptive = detectAdaptiveWatermarkRegion({
      imageData: originalImageData,
      alpha96,
      defaultConfig: config
    });
    const adaptiveConfidence = adaptive?.confidence ?? null;
    if (!adaptive?.region || !(hasReliableAdaptiveWatermarkSignal(adaptive) || adaptive.confidence >= VALIDATION_MIN_CONFIDENCE_FOR_ADAPTIVE_TRIAL)) {
      return {
        adaptive,
        adaptiveConfidence,
        adaptiveTrial: null
      };
    }
    const size = adaptive.region.size;
    const adaptivePosition = {
      x: adaptive.region.x,
      y: adaptive.region.y,
      width: size,
      height: size
    };
    const adaptiveAlphaMap = resolveAlphaMap(size);
    if (!adaptiveAlphaMap) {
      throw new Error(`Missing alpha map for adaptive size ${size}`);
    }
    const adaptiveConfig = {
      logoSize: size,
      marginRight: originalImageData.width - adaptivePosition.x - size,
      marginBottom: originalImageData.height - adaptivePosition.y - size
    };
    return {
      adaptive,
      adaptiveConfidence,
      adaptiveTrial: evaluateRestorationCandidate({
        originalImageData,
        alphaMap: adaptiveAlphaMap,
        position: adaptivePosition,
        source: "adaptive",
        config: adaptiveConfig,
        baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, adaptivePosition),
        adaptiveConfidence: adaptive.confidence,
        provenance: { adaptive: true },
        includeImageData: false
      })
    };
  }
  function refineSelectedAnchorCandidate({
    originalImageData,
    baseCandidate,
    baseDecisionTier,
    adaptiveConfidence,
    alphaGainCandidates,
    allowTemplateWarp = true
  }) {
    let selectedTrial = ensureCandidateImageData(baseCandidate, originalImageData);
    let alphaMap = baseCandidate.alphaMap;
    let position = baseCandidate.position;
    let config = baseCandidate.config;
    let source = baseCandidate.source;
    let decisionTier = baseDecisionTier || inferDecisionTier(baseCandidate);
    let templateWarp = null;
    let selectedAlphaGain = baseCandidate.alphaGain ?? 1;
    const warpCandidate = allowTemplateWarp ? findBestTemplateWarp({
      originalImageData,
      alphaMap,
      position,
      baselineSpatialScore: selectedTrial.originalSpatialScore,
      baselineGradientScore: selectedTrial.originalGradientScore,
      shiftCandidates: selectedTrial.provenance?.previewAnchor === true ? PREVIEW_TEMPLATE_ALIGN_SHIFTS : TEMPLATE_ALIGN_SHIFTS,
      scaleCandidates: selectedTrial.provenance?.previewAnchor === true ? PREVIEW_TEMPLATE_ALIGN_SCALES : TEMPLATE_ALIGN_SCALES
    }) : null;
    if (warpCandidate) {
      const warpedTrial = evaluateRestorationCandidate({
        originalImageData,
        alphaMap: warpCandidate.alphaMap,
        position,
        source: `${source}+warp`,
        config,
        baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, position),
        adaptiveConfidence,
        provenance: selectedTrial.provenance,
        includeImageData: false
      });
      const betterWarpTrial = pickBetterCandidate(selectedTrial, warpedTrial);
      if (betterWarpTrial !== selectedTrial) {
        alphaMap = warpedTrial.alphaMap;
        source = betterWarpTrial.source;
        selectedTrial = ensureCandidateImageData(betterWarpTrial, originalImageData);
        templateWarp = warpCandidate.shift;
        decisionTier = inferDecisionTier(betterWarpTrial, {
          directMatch: decisionTier === "direct-match"
        });
      }
    }
    const shouldRunGainSearch = selectedTrial.provenance?.previewAnchor === true ? isPreviewAnchorGainSearchRequired(selectedTrial) : isCurrentLargeMarginCatalogCandidate(selectedTrial) && selectedTrial.alphaGain < 1 ? false : shouldEscalateSearch(selectedTrial);
    let bestGainTrial = selectedTrial;
    if (shouldRunGainSearch) {
      for (const candidateGain of alphaGainCandidates) {
        if (!Number.isFinite(candidateGain) || candidateGain <= 1) continue;
        if (selectedTrial.provenance?.previewAnchor === true && position.width < 40 && candidateGain > 1.1) {
          continue;
        }
        const gainTrial = evaluateRestorationCandidate({
          originalImageData,
          alphaMap,
          position,
          source: `${source}+gain`,
          config,
          baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, position),
          adaptiveConfidence,
          alphaGain: candidateGain,
          provenance: selectedTrial.provenance,
          includeImageData: false
        });
        bestGainTrial = pickBetterCandidate(bestGainTrial, gainTrial);
      }
    }
    if (bestGainTrial !== selectedTrial) {
      selectedTrial = ensureCandidateImageData(bestGainTrial, originalImageData);
      source = bestGainTrial.source;
      selectedAlphaGain = bestGainTrial.alphaGain;
      decisionTier = inferDecisionTier(bestGainTrial, {
        directMatch: decisionTier === "direct-match"
      });
    }
    return {
      selectedTrial: ensureCandidateImageData(selectedTrial, originalImageData),
      source,
      alphaMap,
      position,
      config,
      templateWarp,
      alphaGain: selectedAlphaGain,
      decisionTier
    };
  }
  function selectInitialCandidate({
    originalImageData,
    config,
    position,
    alpha48,
    alpha96,
    getAlphaMap,
    allowAdaptiveSearch,
    allowAutomaticSearch = true,
    allowAggressiveStrongLocated = false,
    alphaGainCandidates,
    alphaPriorityGains = [1],
    alpha96Variants = null
  }) {
    const resolveAlphaMap = createAlphaMapResolver({ alpha48, alpha96, getAlphaMap });
    const fallbackAlphaMap = config.logoSize === 96 ? alpha96 : alpha48;
    const {
      standardCandidateSeeds,
      standardTrials,
      standardTrial,
      standardSpatialScore,
      standardGradientScore,
      hasReliableStandardMatch
    } = resolveStandardAnchorSelection({
      originalImageData,
      config,
      position,
      alpha48,
      alpha96,
      alpha96Variants,
      getAlphaMap,
      resolveAlphaMap,
      alphaPriorityGains,
      forceCatalogVariants: !allowAutomaticSearch
    });
    let baseCandidate = null;
    let baseDecisionTier = "insufficient";
    if (hasReliableStandardMatch && standardTrial?.accepted) {
      baseCandidate = standardTrial;
      baseDecisionTier = "direct-match";
    } else if (standardTrial?.accepted) {
      baseCandidate = {
        ...standardTrial,
        source: `${standardTrial.source}+validated`
      };
      baseDecisionTier = "validated-match";
    }
    let adaptive = null;
    let adaptiveConfidence = null;
    let adaptiveTrial = null;
    for (const candidate of standardTrials) {
      if (!candidate || candidate === standardTrial) continue;
      ({
        baseCandidate,
        baseDecisionTier
      } = promoteBaseCandidate(baseCandidate, baseDecisionTier, candidate, {
        reliableMatch: hasReliableStandardWatermarkSignal({
          spatialScore: candidate.originalSpatialScore,
          gradientScore: candidate.originalGradientScore
        })
      }));
    }
    ({
      baseCandidate,
      baseDecisionTier
    } = searchStrongStandardTrialAlphaGain({
      originalImageData,
      standardTrials,
      standardTrial,
      baseCandidate,
      baseDecisionTier,
      alphaGainCandidates
    }));
    const defaultAlphaNewMarginRescue = searchDefaultAlphaNewMarginRescue({
      originalImageData,
      standardTrials,
      alpha96,
      alphaGainCandidates
    });
    if (defaultAlphaNewMarginRescue) {
      ({
        baseCandidate,
        baseDecisionTier
      } = promoteBaseCandidate(baseCandidate, baseDecisionTier, defaultAlphaNewMarginRescue));
    }
    if (allowAutomaticSearch) {
      const previewAnchorCandidate = searchBottomRightPreviewCandidate({
        originalImageData,
        config,
        alpha48,
        alpha96,
        getAlphaMap,
        resolveAlphaMap,
        adaptiveConfidence
      });
      if (previewAnchorCandidate) {
        ({
          baseCandidate,
          baseDecisionTier
        } = promoteBaseCandidate(baseCandidate, baseDecisionTier, previewAnchorCandidate));
      }
    }
    if (allowAutomaticSearch && baseDecisionTier !== "direct-match" && !baseCandidate?.provenance?.previewAnchor && shouldEscalateSearch(baseCandidate)) {
      const sizeJitterCandidate = searchStandardSizeJitterCandidate({
        originalImageData,
        candidateSeeds: standardCandidateSeeds,
        alpha48,
        alpha96,
        getAlphaMap,
        resolveAlphaMap
      });
      if (sizeJitterCandidate) {
        ({
          baseCandidate,
          baseDecisionTier
        } = promoteBaseCandidate(baseCandidate, baseDecisionTier, sizeJitterCandidate));
      }
    }
    if (allowAutomaticSearch && baseDecisionTier !== "direct-match" && baseCandidate?.provenance?.sizeJitter === true && !baseCandidate?.provenance?.previewAnchor && isStandardCandidateSource(baseCandidate) && shouldEscalateSearch(baseCandidate)) {
      const fineLocalCandidate = searchFineStandardLocalCandidate({
        originalImageData,
        seedCandidate: baseCandidate,
        adaptiveConfidence
      });
      if (fineLocalCandidate) {
        ({
          baseCandidate,
          baseDecisionTier
        } = promoteBaseCandidate(baseCandidate, baseDecisionTier, fineLocalCandidate));
      }
    }
    const shouldEvaluateAdaptive = () => {
      if (!allowAdaptiveSearch || !alpha96) return false;
      if (!baseCandidate) return true;
      if (!shouldEscalateSearch(baseCandidate)) return false;
      baseCandidate = ensureCandidateImageData(baseCandidate, originalImageData);
      return shouldAttemptAdaptiveFallback({
        processedImageData: baseCandidate.imageData,
        alphaMap: baseCandidate.alphaMap,
        position: baseCandidate.position,
        originalImageData,
        originalSpatialMismatchThreshold: 0
      });
    };
    if (allowAutomaticSearch && shouldEvaluateAdaptive()) {
      ({
        adaptive,
        adaptiveConfidence,
        adaptiveTrial
      } = evaluateAdaptiveTrial({
        originalImageData,
        config,
        alpha96,
        resolveAlphaMap,
        allowAdaptiveSearch
      }));
    }
    if (adaptiveTrial) {
      ({
        baseCandidate,
        baseDecisionTier
      } = promoteBaseCandidate(baseCandidate, baseDecisionTier, adaptiveTrial, {
        reliableMatch: hasReliableAdaptiveWatermarkSignal(adaptive)
      }));
    }
    if (allowAutomaticSearch && !baseCandidate?.provenance?.previewAnchor && !hasReliableAdaptiveWatermarkSignal(adaptive) && shouldSearchNearbyStandardCandidate(baseCandidate, originalImageData)) {
      const nearbyStandardCandidate = searchNearbyStandardCandidate({
        originalImageData,
        candidateSeeds: standardCandidateSeeds,
        adaptiveConfidence
      });
      if (nearbyStandardCandidate) {
        ({
          baseCandidate,
          baseDecisionTier
        } = promoteBaseCandidate(baseCandidate, baseDecisionTier, nearbyStandardCandidate));
      }
    }
    if (allowAutomaticSearch && !baseCandidate) {
      const bestEffortCandidate = searchBestEffortCurrentLargeMarginWeakAlpha({
        originalImageData,
        standardTrials,
        alphaGainCandidates
      });
      if (bestEffortCandidate) {
        baseCandidate = bestEffortCandidate;
        baseDecisionTier = "direct-match";
      }
    }
    if (!allowAutomaticSearch && !baseCandidate) {
      const bestEffortCandidate = searchBestEffortCurrentLargeMarginWeakAlpha({
        originalImageData,
        standardTrials,
        alphaGainCandidates
      });
      if (bestEffortCandidate) {
        baseCandidate = bestEffortCandidate;
        baseDecisionTier = "direct-match";
      } else {
        const fixedCoreLocalGeometryCandidate = searchFixedCoreLocalGeometryCandidate({
          originalImageData,
          candidateSeeds: standardCandidateSeeds,
          resolveAlphaMap,
          alphaGainCandidates
        });
        if (fixedCoreLocalGeometryCandidate) {
          baseCandidate = fixedCoreLocalGeometryCandidate;
          baseDecisionTier = "direct-match";
        }
      }
    }
    if (!baseCandidate) {
      if (hasReliableStandardMatch && standardTrial?.accepted) {
        baseCandidate = standardTrial;
        baseDecisionTier = "direct-match";
      } else if (hasReliableAdaptiveWatermarkSignal(adaptive) && adaptiveTrial) {
        baseCandidate = adaptiveTrial;
        baseDecisionTier = "direct-match";
      }
    }
    if (!baseCandidate) {
      const validatedCandidate = pickBestValidatedCandidate([
        ...standardTrials,
        adaptiveTrial
      ]);
      if (!validatedCandidate) {
        const aggressiveLocatedCandidate = allowAggressiveStrongLocated ? pickAggressiveStrongLocatedCandidate([
          ...standardTrials,
          adaptiveTrial
        ]) : null;
        if (aggressiveLocatedCandidate) {
          baseCandidate = {
            ...aggressiveLocatedCandidate,
            source: `${aggressiveLocatedCandidate.source}+aggressive-located`
          };
          baseDecisionTier = "direct-match";
        } else {
          const fixedCoreLocalGeometryCandidate = !allowAutomaticSearch ? searchFixedCoreLocalGeometryCandidate({
            originalImageData,
            candidateSeeds: standardCandidateSeeds,
            resolveAlphaMap,
            alphaGainCandidates
          }) : null;
          if (fixedCoreLocalGeometryCandidate) {
            baseCandidate = fixedCoreLocalGeometryCandidate;
            baseDecisionTier = "direct-match";
          } else {
            return {
              selectedTrial: null,
              source: "skipped",
              alphaMap: fallbackAlphaMap,
              position,
              config,
              adaptiveConfidence,
              standardSpatialScore,
              standardGradientScore,
              templateWarp: null,
              alphaGain: 1,
              decisionTier: "insufficient"
            };
          }
        }
      } else {
        baseCandidate = {
          ...validatedCandidate,
          source: `${validatedCandidate.source}+validated`
        };
        baseDecisionTier = "validated-match";
      }
    }
    if (shouldRevertLocalShiftToStandardTrial(baseCandidate, standardTrial)) {
      baseCandidate = standardTrial;
      baseDecisionTier = hasReliableStandardMatch ? "direct-match" : "validated-match";
    }
    if (!allowAutomaticSearch && isCurrentLargeMarginCatalogCandidate(baseCandidate)) {
      const initialCanonical96Candidate = config?.logoSize === 96 && config.marginRight === 64 && config.marginBottom === 64 && fallbackAlphaMap ? evaluateRestorationCandidate({
        originalImageData,
        alphaMap: fallbackAlphaMap,
        position,
        source: "standard",
        config,
        baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, position),
        alphaGain: 1,
        provenance: null,
        includeImageData: false
      }) : null;
      const fixedCoreCanonical96Candidate = searchFixedCoreStrongStandardAlphaGain({
        originalImageData,
        baseCandidate: initialCanonical96Candidate,
        alphaGainCandidates
      });
      if (shouldPreserveStrongCanonical96AgainstWeakCurrentLargeMargin(fixedCoreCanonical96Candidate, baseCandidate)) {
        baseCandidate = fixedCoreCanonical96Candidate;
        baseDecisionTier = "direct-match";
      }
    }
    if (!allowAutomaticSearch && !isStrictFixedCoreCandidate(baseCandidate)) {
      const fixedCoreStrongAlphaGainCandidate = searchFixedCoreStrongStandardAlphaGain({
        originalImageData,
        baseCandidate,
        alphaGainCandidates
      });
      if (fixedCoreStrongAlphaGainCandidate) {
        baseCandidate = fixedCoreStrongAlphaGainCandidate;
        baseDecisionTier = "direct-match";
      } else {
        const bestEffortCandidate = searchBestEffortCurrentLargeMarginWeakAlpha({
          originalImageData,
          standardTrials,
          alphaGainCandidates
        });
        if (bestEffortCandidate) {
          baseCandidate = bestEffortCandidate;
          baseDecisionTier = "direct-match";
        } else {
          const fixedCoreLocalGeometryCandidate = searchFixedCoreLocalGeometryCandidate({
            originalImageData,
            candidateSeeds: standardCandidateSeeds,
            resolveAlphaMap,
            alphaGainCandidates
          });
          baseCandidate = fixedCoreLocalGeometryCandidate;
          baseDecisionTier = fixedCoreLocalGeometryCandidate ? "direct-match" : "insufficient";
        }
      }
    }
    if (!baseCandidate) {
      const validatedCandidate = allowAutomaticSearch ? pickBestValidatedCandidate([
        ...standardTrials,
        adaptiveTrial
      ]) : null;
      if (!validatedCandidate) {
        const aggressiveLocatedCandidate = allowAggressiveStrongLocated ? pickAggressiveStrongLocatedCandidate([
          ...standardTrials,
          adaptiveTrial
        ]) : null;
        if (aggressiveLocatedCandidate) {
          baseCandidate = {
            ...aggressiveLocatedCandidate,
            source: `${aggressiveLocatedCandidate.source}+aggressive-located`
          };
          baseDecisionTier = "direct-match";
        } else {
          const fixedCoreLocalGeometryCandidate = !allowAutomaticSearch ? searchFixedCoreLocalGeometryCandidate({
            originalImageData,
            candidateSeeds: standardCandidateSeeds,
            resolveAlphaMap,
            alphaGainCandidates
          }) : null;
          if (fixedCoreLocalGeometryCandidate) {
            baseCandidate = fixedCoreLocalGeometryCandidate;
            baseDecisionTier = "direct-match";
          } else {
            return {
              selectedTrial: null,
              source: "skipped",
              alphaMap: fallbackAlphaMap,
              position,
              config,
              adaptiveConfidence,
              standardSpatialScore,
              standardGradientScore,
              templateWarp: null,
              alphaGain: 1,
              decisionTier: "insufficient"
            };
          }
        }
      } else {
        baseCandidate = {
          ...validatedCandidate,
          source: `${validatedCandidate.source}+validated`
        };
        baseDecisionTier = "validated-match";
      }
    }
    if (isCurrentLargeMarginCatalogCandidate(baseCandidate)) {
      const initialCanonical96Seed = config?.logoSize === 96 && config.marginRight === 64 && config.marginBottom === 64 && fallbackAlphaMap ? evaluateRestorationCandidate({
        originalImageData,
        alphaMap: fallbackAlphaMap,
        position,
        source: "standard",
        config,
        baselineNearBlackRatio: calculateNearBlackRatio(originalImageData, position),
        alphaGain: 1,
        provenance: null,
        includeImageData: false
      }) : null;
      const rawCanonical96Seed = standardTrials.find((candidate) => isCanonicalDefault96Candidate(candidate)) ?? (isCanonicalDefault96Candidate(standardTrial) ? standardTrial : null) ?? standardTrials.find((candidate) => isDefault96GeometryCandidate(candidate)) ?? (isDefault96GeometryCandidate(standardTrial) ? standardTrial : null) ?? initialCanonical96Seed;
      const canonical96Seed = rawCanonical96Seed && !isCanonicalDefault96Candidate(rawCanonical96Seed) ? {
        ...rawCanonical96Seed,
        source: "standard",
        provenance: null
      } : rawCanonical96Seed;
      const strictCanonical96Candidate = isStrictFixedCoreCandidate(canonical96Seed) ? canonical96Seed : searchFixedCoreStrongStandardAlphaGain({
        originalImageData,
        baseCandidate: canonical96Seed,
        alphaGainCandidates
      });
      if (shouldPreserveStrongCanonical96AgainstWeakCurrentLargeMargin(strictCanonical96Candidate, baseCandidate)) {
        baseCandidate = strictCanonical96Candidate;
        baseDecisionTier = "direct-match";
      }
    }
    const {
      selectedTrial,
      source,
      alphaMap,
      position: refinedPosition,
      config: refinedConfig,
      templateWarp,
      alphaGain,
      decisionTier
    } = refineSelectedAnchorCandidate({
      originalImageData,
      baseCandidate,
      baseDecisionTier,
      adaptiveConfidence,
      alphaGainCandidates,
      allowTemplateWarp: allowAutomaticSearch
    });
    return {
      selectedTrial: ensureCandidateImageData(selectedTrial, originalImageData),
      source,
      alphaMap,
      position: refinedPosition,
      config: refinedConfig,
      adaptiveConfidence,
      standardSpatialScore,
      standardGradientScore,
      templateWarp,
      alphaGain,
      decisionTier
    };
  }

  // src/core/previewAlphaCalibration.js
  function clamp01(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }
  function blurAlphaMap(alphaMap, size, radius = 0) {
    const blurPasses = Number.isInteger(radius) ? radius : Math.max(0, Math.round(radius || 0));
    if (blurPasses <= 0 || size <= 0) {
      return new Float32Array(alphaMap);
    }
    let current = new Float32Array(alphaMap);
    for (let pass = 0; pass < blurPasses; pass++) {
      const next = new Float32Array(current.length);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let sum = 0;
          let weight = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx;
              const yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
              const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
              sum += current[yy * size + xx] * w;
              weight += w;
            }
          }
          next[y * size + x] = clamp01(sum / Math.max(1, weight));
        }
      }
      current = next;
    }
    return current;
  }
  function cloneImageData2(imageData) {
    return {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data)
    };
  }
  function clampChannel(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 255) return 255;
    return Math.round(value);
  }
  function averageStripColor(imageData, {
    xFrom,
    xTo,
    yFrom,
    yTo
  }) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    const minX = Math.max(0, Math.min(xFrom, xTo));
    const maxX = Math.min(imageData.width - 1, Math.max(xFrom, xTo));
    const minY = Math.max(0, Math.min(yFrom, yTo));
    const maxY = Math.min(imageData.height - 1, Math.max(yFrom, yTo));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const idx = (y * imageData.width + x) * 4;
        sumR += imageData.data[idx];
        sumG += imageData.data[idx + 1];
        sumB += imageData.data[idx + 2];
        count++;
      }
    }
    if (count <= 0) {
      return [0, 0, 0];
    }
    return [sumR / count, sumG / count, sumB / count];
  }
  function lerpColor(left, right, t) {
    return [
      left[0] * (1 - t) + right[0] * t,
      left[1] * (1 - t) + right[1] * t,
      left[2] * (1 - t) + right[2] * t
    ];
  }
  function buildPreviewNeighborhoodPrior({
    previewImageData,
    position,
    radius = 6
  }) {
    if (!previewImageData || !position) {
      throw new TypeError("buildPreviewNeighborhoodPrior requires previewImageData and position");
    }
    const stripRadius = Math.max(1, Math.round(radius || 1));
    const prior = cloneImageData2(previewImageData);
    const leftBoundary = [];
    const rightBoundary = [];
    const topBoundary = [];
    const bottomBoundary = [];
    for (let row = 0; row < position.height; row++) {
      const y = position.y + row;
      leftBoundary.push(averageStripColor(previewImageData, {
        xFrom: position.x - stripRadius,
        xTo: position.x - 1,
        yFrom: y - 1,
        yTo: y + 1
      }));
      rightBoundary.push(averageStripColor(previewImageData, {
        xFrom: position.x + position.width,
        xTo: position.x + position.width + stripRadius - 1,
        yFrom: y - 1,
        yTo: y + 1
      }));
    }
    for (let col = 0; col < position.width; col++) {
      const x = position.x + col;
      topBoundary.push(averageStripColor(previewImageData, {
        xFrom: x - 1,
        xTo: x + 1,
        yFrom: position.y - stripRadius,
        yTo: position.y - 1
      }));
      bottomBoundary.push(averageStripColor(previewImageData, {
        xFrom: x - 1,
        xTo: x + 1,
        yFrom: position.y + position.height,
        yTo: position.y + position.height + stripRadius - 1
      }));
    }
    for (let row = 0; row < position.height; row++) {
      const ty = position.height <= 1 ? 0.5 : row / (position.height - 1);
      for (let col = 0; col < position.width; col++) {
        const tx = position.width <= 1 ? 0.5 : col / (position.width - 1);
        const horizontal = lerpColor(leftBoundary[row], rightBoundary[row], tx);
        const vertical = lerpColor(topBoundary[col], bottomBoundary[col], ty);
        const idx = ((position.y + row) * prior.width + (position.x + col)) * 4;
        prior.data[idx] = clampChannel((horizontal[0] + vertical[0]) * 0.5);
        prior.data[idx + 1] = clampChannel((horizontal[1] + vertical[1]) * 0.5);
        prior.data[idx + 2] = clampChannel((horizontal[2] + vertical[2]) * 0.5);
      }
    }
    if (position.width <= 1 || position.height <= 1) {
      return prior;
    }
    const relaxationPasses = Math.max(24, Math.round((position.width + position.height) * 2));
    for (let pass = 0; pass < relaxationPasses; pass++) {
      for (let row = 0; row < position.height; row++) {
        const y = position.y + row;
        for (let col = 0; col < position.width; col++) {
          const x = position.x + col;
          const idx = (y * prior.width + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            let sum = 0;
            let weight = 0;
            const neighbors = [
              [x - 1, y, 1],
              [x + 1, y, 1],
              [x, y - 1, 1],
              [x, y + 1, 1],
              [x - 1, y - 1, 0.5],
              [x + 1, y - 1, 0.5],
              [x - 1, y + 1, 0.5],
              [x + 1, y + 1, 0.5]
            ];
            for (const [neighborX, neighborY, neighborWeight] of neighbors) {
              if (neighborX < 0 || neighborY < 0 || neighborX >= prior.width || neighborY >= prior.height) {
                continue;
              }
              const neighborIdx = (neighborY * prior.width + neighborX) * 4;
              sum += prior.data[neighborIdx + channel] * neighborWeight;
              weight += neighborWeight;
            }
            prior.data[idx + channel] = clampChannel(sum / Math.max(1, weight));
          }
        }
      }
    }
    return prior;
  }

  // src/core/pipelineAlphaTraceContract.js
  function finiteOrNull5(value) {
    return Number.isFinite(value) ? value : null;
  }
  function normalizeAlphaTrialEventForTrace(event) {
    return event && typeof event === "object" ? event : null;
  }
  function normalizeAlphaAdjustmentStageForTrace(stagePayload = {}) {
    if (!stagePayload || typeof stagePayload !== "object") return null;
    const {
      stage,
      fromAlphaGain,
      toAlphaGain,
      beforeSpatialScore,
      beforeGradientScore,
      afterSpatialScore,
      afterGradientScore,
      suppressionGain: stageSuppressionGain = null,
      cost = null,
      profileExponent = null,
      alphaStrategy = null,
      repairStrategy = null,
      allowSameAlphaGain = false
    } = stagePayload;
    if (!stage || !Number.isFinite(fromAlphaGain) || !Number.isFinite(toAlphaGain)) return null;
    if (!allowSameAlphaGain && Math.abs(fromAlphaGain - toAlphaGain) < 1e-4) return null;
    return {
      stage,
      fromAlphaGain,
      toAlphaGain,
      beforeSpatialScore: finiteOrNull5(beforeSpatialScore),
      beforeGradientScore: finiteOrNull5(beforeGradientScore),
      afterSpatialScore: finiteOrNull5(afterSpatialScore),
      afterGradientScore: finiteOrNull5(afterGradientScore),
      suppressionGain: finiteOrNull5(stageSuppressionGain),
      cost: finiteOrNull5(cost),
      profileExponent: finiteOrNull5(profileExponent),
      alphaStrategy: typeof alphaStrategy === "string" && alphaStrategy.length > 0 ? alphaStrategy : null,
      repairStrategy: typeof repairStrategy === "string" && repairStrategy.length > 0 ? repairStrategy : null
    };
  }

  // src/core/pipelineTrace.js
  function createPipelineTraceRecorder() {
    const alphaAdjustmentStages = [];
    const alphaTrialEvents = [];
    const recordAlphaTrialEvent = (event) => {
      const normalizedEvent = normalizeAlphaTrialEventForTrace(event);
      if (!normalizedEvent) return;
      alphaTrialEvents.push(normalizedEvent);
    };
    const recordAlphaAdjustmentStage = (stagePayload) => {
      const normalizedStage = normalizeAlphaAdjustmentStageForTrace(stagePayload);
      if (!normalizedStage) return;
      alphaAdjustmentStages.push(normalizedStage);
    };
    return {
      alphaAdjustmentStages,
      alphaTrialEvents,
      recordAlphaAdjustmentStage,
      recordAlphaTrialEvent
    };
  }

  // src/core/watermarkConfig.js
  function detectWatermarkConfig(imageWidth, imageHeight) {
    const officialConfig = resolveOfficialGeminiWatermarkConfig(imageWidth, imageHeight);
    if (officialConfig) {
      return { ...officialConfig };
    }
    if (imageWidth > 1024 && imageHeight > 1024) {
      return {
        logoSize: 96,
        marginRight: 64,
        marginBottom: 64
      };
    }
    return {
      logoSize: 48,
      marginRight: 32,
      marginBottom: 32
    };
  }
  function calculateWatermarkPosition(imageWidth, imageHeight, config) {
    const { logoSize, marginRight, marginBottom } = config;
    return {
      x: imageWidth - marginRight - logoSize,
      y: imageHeight - marginBottom - logoSize,
      width: logoSize,
      height: logoSize
    };
  }
  function getStandardConfig(size) {
    return size === 96 ? { logoSize: 96, marginRight: 64, marginBottom: 64 } : { logoSize: 48, marginRight: 32, marginBottom: 32 };
  }
  function getAlphaMapForConfig(config, alpha48, alpha96) {
    if (!config) return null;
    if (config.logoSize === 48) return alpha48;
    if (config.logoSize === 96) return alpha96;
    return alpha96 ? interpolateAlphaMap(alpha96, 96, config.logoSize) : null;
  }
  function isRegionInsideImage(imageData, region) {
    return region.x >= 0 && region.y >= 0 && region.x + region.width <= imageData.width && region.y + region.height <= imageData.height;
  }
  function resolveInitialStandardConfig({
    imageData,
    defaultConfig,
    alpha48,
    alpha96,
    minSwitchScore = 0.25,
    minScoreDelta = 0.08
  }) {
    if (!imageData || !defaultConfig || !alpha48 || !alpha96) return defaultConfig;
    const fallbackConfig = getStandardConfig(48);
    const primaryConfig = defaultConfig.logoSize === 96 ? getStandardConfig(96) : fallbackConfig;
    const alternateConfig = defaultConfig.logoSize === 96 ? fallbackConfig : getStandardConfig(96);
    const candidateConfigs = [primaryConfig, alternateConfig];
    for (const officialConfig of resolveOfficialGeminiSearchConfigs(imageData.width, imageData.height, {
      limit: 1
    })) {
      if (!candidateConfigs.some((candidate) => candidate.logoSize === officialConfig.logoSize && candidate.marginRight === officialConfig.marginRight && candidate.marginBottom === officialConfig.marginBottom)) {
        candidateConfigs.push(officialConfig);
      }
    }
    let bestConfig = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidateConfig of candidateConfigs) {
      const candidateRegion = calculateWatermarkPosition(
        imageData.width,
        imageData.height,
        candidateConfig
      );
      if (!isRegionInsideImage(imageData, candidateRegion)) continue;
      const alphaMap = getAlphaMapForConfig(candidateConfig, alpha48, alpha96);
      if (!alphaMap) continue;
      const candidateScore = computeRegionSpatialCorrelation({
        imageData,
        alphaMap,
        region: {
          x: candidateRegion.x,
          y: candidateRegion.y,
          size: candidateRegion.width
        }
      });
      if (!bestConfig) {
        bestConfig = candidateConfig;
        bestScore = candidateScore;
        continue;
      }
      if (candidateScore >= minSwitchScore && candidateScore > bestScore + minScoreDelta) {
        bestConfig = candidateConfig;
        bestScore = candidateScore;
      }
    }
    return bestConfig ?? defaultConfig;
  }

  // src/core/pipelineInitialContext.js
  function createInitialPipelineContext({
    imageData,
    options = {},
    cloneImageData: cloneImageData4,
    alphaGainCandidates = [],
    alphaPriorityGains = [],
    detectConfig = detectWatermarkConfig,
    resolveConfig = resolveInitialStandardConfig,
    calculatePosition = calculateWatermarkPosition
  } = {}) {
    const adaptiveMode = options.adaptiveMode || "auto";
    const allowAdaptiveSearch = adaptiveMode !== "never" && adaptiveMode !== "off";
    const originalImageData = cloneImageData4(imageData);
    const { alpha48, alpha96 } = options;
    if (!alpha48 || !alpha96) {
      throw new Error("processWatermarkImageData requires alpha48 and alpha96");
    }
    const defaultConfig = detectConfig(originalImageData.width, originalImageData.height);
    const resolvedConfig = resolveConfig({
      imageData: originalImageData,
      defaultConfig,
      alpha48,
      alpha96
    });
    const position = calculatePosition(
      originalImageData.width,
      originalImageData.height,
      resolvedConfig
    );
    return {
      originalImageData,
      alpha48,
      alpha96,
      alphaGainCandidates,
      alphaPriorityGains,
      allowAdaptiveSearch,
      defaultConfig,
      resolvedConfig,
      position
    };
  }

  // src/core/pipelineInitialSelection.js
  function selectInitialWatermarkCandidate({
    originalImageData,
    config,
    position,
    alpha48,
    alpha96,
    alpha96Variants = null,
    getAlphaMap = null,
    allowAdaptiveSearch = true,
    aggressiveLocatedFallback = true,
    alphaGainCandidates,
    alphaPriorityGains,
    selectCandidate = selectInitialCandidate
  } = {}) {
    let initialSelection = selectCandidate({
      originalImageData,
      config,
      position,
      alpha48,
      alpha96,
      alpha96Variants,
      getAlphaMap,
      allowAdaptiveSearch,
      allowAutomaticSearch: false,
      alphaGainCandidates,
      alphaPriorityGains
    });
    if (!initialSelection.selectedTrial && aggressiveLocatedFallback !== false) {
      const aggressiveSelection = selectCandidate({
        originalImageData,
        config,
        position,
        alpha48,
        alpha96,
        alpha96Variants,
        getAlphaMap,
        allowAdaptiveSearch,
        allowAutomaticSearch: true,
        allowAggressiveStrongLocated: true,
        alphaGainCandidates,
        alphaPriorityGains
      });
      if (aggressiveSelection.selectedTrial) {
        initialSelection = {
          ...aggressiveSelection,
          source: aggressiveSelection.source.includes("aggressive-located") ? aggressiveSelection.source : `${aggressiveSelection.source}+aggressive-located`,
          decisionTier: aggressiveSelection.decisionTier || "direct-match"
        };
      }
    }
    return initialSelection;
  }

  // src/core/pipelineMeta.js
  function normalizeMetaPosition(position) {
    if (!position) return null;
    const { x, y, width, height } = position;
    if (![x, y, width, height].every((value) => Number.isFinite(value))) {
      return null;
    }
    return { x, y, width, height };
  }
  function normalizeMetaConfig(config) {
    if (!config) return null;
    const { logoSize, marginRight, marginBottom } = config;
    if (![logoSize, marginRight, marginBottom].every((value) => Number.isFinite(value))) {
      return null;
    }
    return {
      logoSize,
      marginRight,
      marginBottom,
      ...typeof config.alphaVariant === "string" && config.alphaVariant.length > 0 ? { alphaVariant: config.alphaVariant } : {}
    };
  }
  function createWatermarkMeta({
    position = null,
    config = null,
    adaptiveConfidence = null,
    originalSpatialScore = null,
    originalGradientScore = null,
    processedSpatialScore = null,
    processedGradientScore = null,
    suppressionGain = null,
    residualVisibility = null,
    templateWarp = null,
    alphaGain = 1,
    passCount = 0,
    attemptedPassCount = 0,
    passStopReason = null,
    passes = null,
    source = "standard",
    decisionTier = null,
    applied = true,
    skipReason = null,
    subpixelShift = null,
    selectionDebug = null,
    alphaAdjustmentStages = null,
    alphaMapSource = null,
    decisionPath = null
  } = {}) {
    const normalizedPosition = normalizeMetaPosition(position);
    return {
      applied,
      skipReason: applied ? null : skipReason,
      size: normalizedPosition ? normalizedPosition.width : null,
      position: normalizedPosition,
      config: normalizeMetaConfig(config),
      detection: {
        adaptiveConfidence,
        originalSpatialScore,
        originalGradientScore,
        processedSpatialScore,
        processedGradientScore,
        suppressionGain,
        residualVisibility
      },
      templateWarp: templateWarp ?? null,
      alphaGain,
      passCount,
      attemptedPassCount,
      passStopReason,
      passes: Array.isArray(passes) ? passes : null,
      // decisionTier is the normalized contract used by UI and attribution.
      // source remains as a verbose execution trace for debugging/tests.
      source,
      decisionTier,
      subpixelShift: subpixelShift ?? null,
      selectionDebug,
      alphaAdjustmentStages: Array.isArray(alphaAdjustmentStages) ? alphaAdjustmentStages : null,
      alphaMapSource: alphaMapSource ?? null,
      decisionPath: decisionPath ?? null
    };
  }
  function createAcceptedWatermarkMeta({
    selectedTrial = null,
    selectionSource = null,
    position = null,
    config = null,
    adaptiveConfidence = null,
    originalSpatialScore = null,
    originalGradientScore = null,
    processedSpatialScore = null,
    processedGradientScore = null,
    suppressionGain = null,
    residualVisibility = null,
    templateWarp = null,
    alphaGain = 1,
    passCount = 0,
    attemptedPassCount = 0,
    passStopReason = null,
    passes = null,
    source = "standard",
    decisionTier = null,
    subpixelShift = null,
    selectionDebug = null,
    alphaAdjustmentStages = null,
    alphaTrialEvents = null,
    alphaMapSource = null
  } = {}) {
    const decisionPath = createAcceptedDecisionPath({
      selectedTrial,
      selectionSource,
      source,
      decisionTier,
      config,
      position,
      adaptiveConfidence,
      alphaGain,
      alphaMapSource,
      templateWarp,
      alphaAdjustmentStages,
      alphaTrialEvents,
      originalSpatialScore,
      originalGradientScore,
      processedSpatialScore,
      processedGradientScore,
      suppressionGain,
      residualVisibility
    });
    return createWatermarkMeta({
      position,
      config,
      adaptiveConfidence,
      originalSpatialScore,
      originalGradientScore,
      processedSpatialScore,
      processedGradientScore,
      suppressionGain,
      residualVisibility,
      templateWarp,
      alphaGain,
      passCount,
      attemptedPassCount,
      passStopReason,
      passes,
      source,
      decisionTier,
      applied: true,
      subpixelShift,
      alphaAdjustmentStages,
      alphaMapSource,
      selectionDebug,
      decisionPath
    });
  }
  function createRejectedWatermarkMeta({
    reason = "no-watermark-detected",
    source = "skipped",
    decisionTier = "insufficient",
    adaptiveConfidence = null,
    originalSpatialScore = null,
    originalGradientScore = null,
    selectionDebug = null
  } = {}) {
    return createWatermarkMeta({
      adaptiveConfidence,
      originalSpatialScore,
      originalGradientScore,
      processedSpatialScore: originalSpatialScore,
      processedGradientScore: originalGradientScore,
      suppressionGain: 0,
      alphaGain: 1,
      source,
      decisionTier,
      applied: false,
      skipReason: reason,
      selectionDebug,
      decisionPath: createRejectedDecisionPath({
        reason,
        source,
        decisionTier,
        originalSpatialScore,
        originalGradientScore,
        adaptiveConfidence
      })
    });
  }
  function createUnsafeVisibleResidualWatermarkMeta({
    selectedTrial = null,
    position = null,
    config = null,
    adaptiveConfidence = null,
    originalSpatialScore = null,
    originalGradientScore = null,
    processedSpatialScore = null,
    processedGradientScore = null,
    suppressionGain = null,
    residualVisibility = null,
    templateWarp = null,
    alphaGain = 1,
    passCount = 0,
    attemptedPassCount = 0,
    passStopReason = null,
    passes = null,
    source = "standard",
    decisionTier = null,
    subpixelShift = null,
    selectionDebug = null,
    alphaAdjustmentStages = null,
    alphaMapSource = null
  } = {}) {
    const reason = "visible-residual-unsafe-damage";
    const resolvedPosition = position ?? selectedTrial?.position ?? null;
    const resolvedConfig = config ?? selectedTrial?.config ?? null;
    const detectionCandidate = createDetectionCandidateFromSelectedTrial({
      selectedTrial,
      source,
      config: resolvedConfig,
      position: resolvedPosition,
      adaptiveConfidence,
      decisionTier
    });
    const decisionPath = {
      version: 1,
      decision: "reject",
      detectionSource: detectionCandidate.source,
      alphaSource: null,
      repairSource: null,
      evaluationDecision: "rejected",
      blockedGate: reason,
      riskFlags: [],
      detectionCandidate,
      alphaTrial: null,
      repairTrial: null,
      evaluation: {
        pathId: `${detectionCandidate.id}->reject`,
        detectionId: detectionCandidate.id,
        alphaTrialId: null,
        repairTrialId: null,
        eligible: false,
        decision: "reject",
        blockedGate: reason,
        riskFlags: [],
        evidenceClass: "unsafe-visible-residual",
        explanation: reason
      }
    };
    return createWatermarkMeta({
      position: resolvedPosition,
      config: resolvedConfig,
      adaptiveConfidence,
      originalSpatialScore,
      originalGradientScore,
      processedSpatialScore,
      processedGradientScore,
      suppressionGain,
      residualVisibility,
      templateWarp,
      alphaGain,
      passCount,
      attemptedPassCount,
      passStopReason,
      passes,
      source,
      decisionTier,
      applied: false,
      skipReason: reason,
      subpixelShift,
      alphaAdjustmentStages,
      alphaMapSource,
      selectionDebug,
      decisionPath
    });
  }

  // src/core/pipelineResult.js
  function createRejectedPipelineResult({
    imageData,
    debugTimings = {},
    reason = "no-watermark-detected",
    adaptiveConfidence = null,
    originalSpatialScore = null,
    originalGradientScore = null,
    source = "skipped",
    decisionTier = "insufficient",
    selectionDebug = null
  } = {}) {
    return {
      imageData,
      meta: createRejectedWatermarkMeta({
        reason,
        adaptiveConfidence,
        originalSpatialScore,
        originalGradientScore,
        source,
        decisionTier,
        selectionDebug
      }),
      debugTimings
    };
  }
  function createAcceptedPipelineResult({
    finalImageData,
    debugTimings = {},
    selectedTrial = null,
    selectionSource = null,
    position = null,
    config = null,
    adaptiveConfidence = null,
    originalSpatialScore = null,
    originalGradientScore = null,
    finalProcessedSpatialScore = null,
    finalProcessedGradientScore = null,
    suppressionGain = null,
    residualVisibility = null,
    templateWarp = null,
    alphaGain = 1,
    passCount = 0,
    attemptedPassCount = 0,
    passStopReason = null,
    passes = null,
    source = "standard",
    decisionTier = null,
    subpixelShift = null,
    alphaAdjustmentStages = null,
    alphaTrialEvents = null,
    alphaMapSource = null,
    selectionDebug = null
  } = {}) {
    return {
      imageData: finalImageData,
      meta: createAcceptedWatermarkMeta({
        selectedTrial,
        selectionSource,
        position,
        config,
        adaptiveConfidence,
        originalSpatialScore,
        originalGradientScore,
        processedSpatialScore: finalProcessedSpatialScore,
        processedGradientScore: finalProcessedGradientScore,
        suppressionGain,
        residualVisibility,
        templateWarp,
        alphaGain,
        passCount,
        attemptedPassCount,
        passStopReason,
        passes,
        source,
        decisionTier,
        subpixelShift,
        alphaAdjustmentStages,
        alphaTrialEvents,
        alphaMapSource,
        selectionDebug
      }),
      debugTimings
    };
  }
  function createAcceptedPipelineResultFromState({
    pipelineState = {},
    passState = {},
    traceState = {},
    resultContext = {},
    residualVisibility = null,
    selectionDebug = null
  } = {}) {
    return createAcceptedPipelineResult({
      finalImageData: pipelineState.finalImageData,
      debugTimings: resultContext.debugTimings,
      selectedTrial: resultContext.selectedTrial,
      selectionSource: resultContext.selectionSource,
      position: pipelineState.position,
      config: pipelineState.config,
      adaptiveConfidence: resultContext.adaptiveConfidence,
      originalSpatialScore: pipelineState.originalSpatialScore,
      originalGradientScore: pipelineState.originalGradientScore,
      finalProcessedSpatialScore: pipelineState.finalProcessedSpatialScore,
      finalProcessedGradientScore: pipelineState.finalProcessedGradientScore,
      suppressionGain: pipelineState.suppressionGain,
      residualVisibility,
      templateWarp: resultContext.templateWarp,
      alphaGain: pipelineState.alphaGain,
      passCount: passState.passCount,
      attemptedPassCount: passState.attemptedPassCount,
      passStopReason: passState.passStopReason,
      passes: passState.passes,
      source: pipelineState.source,
      decisionTier: resultContext.decisionTier,
      subpixelShift: resultContext.subpixelShift,
      alphaAdjustmentStages: traceState.alphaAdjustmentStages,
      alphaTrialEvents: traceState.alphaTrialEvents,
      alphaMapSource: pipelineState.alphaMapSource,
      selectionDebug
    });
  }
  function createUnsafeVisibleResidualPipelineResultFromState({
    originalImageData = null,
    pipelineState = {},
    passState = {},
    traceState = {},
    resultContext = {},
    residualVisibility = null,
    selectionDebug = null
  } = {}) {
    return {
      imageData: originalImageData ?? pipelineState.finalImageData,
      meta: createUnsafeVisibleResidualWatermarkMeta({
        selectedTrial: resultContext.selectedTrial,
        position: pipelineState.position,
        config: pipelineState.config,
        adaptiveConfidence: resultContext.adaptiveConfidence,
        originalSpatialScore: pipelineState.originalSpatialScore,
        originalGradientScore: pipelineState.originalGradientScore,
        processedSpatialScore: pipelineState.finalProcessedSpatialScore,
        processedGradientScore: pipelineState.finalProcessedGradientScore,
        suppressionGain: pipelineState.suppressionGain,
        residualVisibility,
        templateWarp: resultContext.templateWarp,
        alphaGain: pipelineState.alphaGain,
        passCount: passState.passCount,
        attemptedPassCount: passState.attemptedPassCount,
        passStopReason: passState.passStopReason,
        passes: passState.passes,
        source: pipelineState.source,
        decisionTier: resultContext.decisionTier,
        subpixelShift: resultContext.subpixelShift,
        alphaAdjustmentStages: traceState.alphaAdjustmentStages,
        alphaMapSource: pipelineState.alphaMapSource,
        selectionDebug
      }),
      debugTimings: resultContext.debugTimings
    };
  }

  // src/core/pipelineState.js
  function finiteOrFallback(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function createAcceptedPipelineState({
    initialSelection = null
  } = {}) {
    const selectedTrial = initialSelection?.selectedTrial ?? null;
    if (!selectedTrial) return null;
    return {
      config: initialSelection.config,
      position: initialSelection.position,
      alphaMap: initialSelection.alphaMap,
      source: initialSelection.source,
      adaptiveConfidence: initialSelection.adaptiveConfidence ?? null,
      templateWarp: initialSelection.templateWarp ?? null,
      alphaGain: finiteOrFallback(initialSelection.alphaGain, 1),
      decisionTier: initialSelection.decisionTier ?? null,
      subpixelShift: null,
      alphaMapSource: null,
      finalImageData: selectedTrial.imageData,
      originalSpatialScore: selectedTrial.originalSpatialScore,
      originalGradientScore: selectedTrial.originalGradientScore
    };
  }
  function createPipelineStateCommit({
    current,
    result,
    source
  } = {}) {
    const finalProcessedSpatialScore = finiteOrFallback(
      result?.spatialScore,
      finiteOrFallback(result?.processedSpatialScore, current?.finalProcessedSpatialScore)
    );
    const finalProcessedGradientScore = finiteOrFallback(
      result?.gradientScore,
      finiteOrFallback(result?.processedGradientScore, current?.finalProcessedGradientScore)
    );
    const originalSpatialScore = finiteOrFallback(
      result?.originalSpatialScore,
      current?.originalSpatialScore
    );
    const suppressionGain = finiteOrFallback(
      result?.suppressionGain,
      originalSpatialScore - finalProcessedSpatialScore
    );
    return {
      finalImageData: result?.imageData ?? current?.finalImageData,
      alphaMap: result?.alphaMap ?? current?.alphaMap,
      position: result?.position ?? current?.position,
      config: result?.config ?? current?.config,
      alphaGain: finiteOrFallback(result?.alphaGain, current?.alphaGain),
      alphaMapSource: result?.alphaMapSource ?? current?.alphaMapSource,
      originalSpatialScore,
      originalGradientScore: finiteOrFallback(
        result?.originalGradientScore,
        current?.originalGradientScore
      ),
      finalProcessedSpatialScore,
      finalProcessedGradientScore,
      suppressionGain,
      source: source ?? current?.source
    };
  }
  function createInitialPipelineRuntimeState({
    acceptedState = null,
    processedMetrics = null
  } = {}) {
    const finalProcessedSpatialScore = processedMetrics?.spatialScore;
    const finalProcessedGradientScore = processedMetrics?.gradientScore;
    const originalSpatialScore = acceptedState?.originalSpatialScore;
    return {
      finalImageData: acceptedState?.finalImageData,
      alphaMap: acceptedState?.alphaMap,
      position: acceptedState?.position,
      config: acceptedState?.config,
      alphaGain: acceptedState?.alphaGain,
      alphaMapSource: acceptedState?.alphaMapSource,
      originalSpatialScore,
      originalGradientScore: acceptedState?.originalGradientScore,
      finalProcessedSpatialScore,
      finalProcessedGradientScore,
      suppressionGain: originalSpatialScore - finalProcessedSpatialScore,
      source: acceptedState?.source
    };
  }
  function createPipelineStateAccessors({
    get,
    set
  } = {}) {
    const safeGet = typeof get === "function" ? get : () => ({});
    const safeSet = typeof set === "function" ? set : () => {
    };
    return {
      readPipelineState() {
        const state = safeGet();
        return {
          finalImageData: state.finalImageData,
          alphaMap: state.alphaMap,
          position: state.position,
          config: state.config,
          alphaGain: state.alphaGain,
          alphaMapSource: state.alphaMapSource,
          originalSpatialScore: state.originalSpatialScore,
          originalGradientScore: state.originalGradientScore,
          finalProcessedSpatialScore: state.finalProcessedSpatialScore,
          finalProcessedGradientScore: state.finalProcessedGradientScore,
          suppressionGain: state.suppressionGain,
          source: state.source
        };
      },
      applyPipelineState(state = {}) {
        safeSet({
          finalImageData: state.finalImageData,
          alphaMap: state.alphaMap,
          position: state.position,
          config: state.config,
          alphaGain: state.alphaGain,
          alphaMapSource: state.alphaMapSource,
          originalSpatialScore: state.originalSpatialScore,
          originalGradientScore: state.originalGradientScore,
          finalProcessedSpatialScore: state.finalProcessedSpatialScore,
          finalProcessedGradientScore: state.finalProcessedGradientScore,
          suppressionGain: state.suppressionGain,
          source: state.source
        });
      }
    };
  }

  // src/core/pipelineMetrics.js
  var FIRST_PASS_SIGN_FLIP_GRADIENT_THRESHOLD = 0.08;
  var FIRST_PASS_SIGN_FLIP_MIN_GRADIENT_DROP = 0.2;
  function shouldStopAfterFirstPass({
    originalSpatialScore,
    originalGradientScore,
    firstPassSpatialScore,
    firstPassGradientScore
  }) {
    if (Math.abs(firstPassSpatialScore) <= 0.25) {
      return true;
    }
    return originalSpatialScore >= 0 && firstPassSpatialScore < 0 && firstPassGradientScore <= FIRST_PASS_SIGN_FLIP_GRADIENT_THRESHOLD && originalGradientScore - firstPassGradientScore >= FIRST_PASS_SIGN_FLIP_MIN_GRADIENT_DROP;
  }
  function createRegionCorrelationMetrics({
    imageData,
    alphaMap,
    position,
    includeNearBlackRatio = false
  } = {}) {
    const region = { x: position.x, y: position.y, size: position.width };
    const metrics = {
      spatialScore: computeRegionSpatialCorrelation({
        imageData,
        alphaMap,
        region
      }),
      gradientScore: computeRegionGradientCorrelation({
        imageData,
        alphaMap,
        region
      })
    };
    if (includeNearBlackRatio) {
      metrics.nearBlackRatio = calculateNearBlackRatio(imageData, position);
    }
    return metrics;
  }
  function createFirstPassMetrics({
    imageData,
    alphaMap,
    position,
    originalSpatialScore,
    originalGradientScore
  } = {}) {
    const firstPassMetrics = createRegionCorrelationMetrics({
      imageData,
      alphaMap,
      position,
      includeNearBlackRatio: true
    });
    const clearedResidual = shouldStopAfterFirstPass({
      originalSpatialScore,
      originalGradientScore,
      firstPassSpatialScore: firstPassMetrics.spatialScore,
      firstPassGradientScore: firstPassMetrics.gradientScore
    });
    return {
      spatialScore: firstPassMetrics.spatialScore,
      gradientScore: firstPassMetrics.gradientScore,
      nearBlackRatio: firstPassMetrics.nearBlackRatio,
      clearedResidual,
      passStopReason: clearedResidual ? "residual-low" : "single-pass",
      passRecord: {
        index: 1,
        beforeSpatialScore: originalSpatialScore,
        beforeGradientScore: originalGradientScore,
        afterSpatialScore: firstPassMetrics.spatialScore,
        afterGradientScore: firstPassMetrics.gradientScore,
        improvement: Math.abs(originalSpatialScore) - Math.abs(firstPassMetrics.spatialScore),
        gradientDelta: firstPassMetrics.gradientScore - originalGradientScore,
        nearBlackRatio: firstPassMetrics.nearBlackRatio
      }
    };
  }

  // src/core/pipelinePassState.js
  function finiteOrFallback2(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }
  function createFirstPassPipelinePassState({
    firstPassMetrics = null
  } = {}) {
    return {
      passCount: 1,
      attemptedPassCount: 1,
      passStopReason: firstPassMetrics?.passStopReason ?? null,
      passes: [firstPassMetrics?.passRecord]
    };
  }
  function applyPipelinePassOutcome({
    current,
    outcome
  } = {}) {
    const passIncrement = Math.max(0, finiteOrFallback2(outcome?.passIncrement, 0));
    return {
      passCount: finiteOrFallback2(current?.passCount, 0) + passIncrement,
      attemptedPassCount: finiteOrFallback2(current?.attemptedPassCount, 0) + passIncrement,
      passStopReason: outcome?.passStopReason ?? current?.passStopReason ?? null,
      passes: current?.passes ?? null
    };
  }

  // src/core/pipelineRepairGates.js
  var DEFAULT_PREVIEW_EDGE_CLEANUP_MAX_SIZE = 32;
  var DEFAULT_KNOWN_48_EDGE_CLEANUP_MIN_SIZE = 40;
  var DEFAULT_KNOWN_48_EDGE_CLEANUP_MAX_SIZE = 56;
  var DEFAULT_V2_SMALL_EDGE_CLEANUP_SIZE = 36;
  var DEFAULT_V2_SMALL_EDGE_CLEANUP_SIZE_TOLERANCE = 2;
  function shouldUsePreviewAnchorFastCleanup(selectedTrial, position, { previewEdgeCleanupMaxSize = DEFAULT_PREVIEW_EDGE_CLEANUP_MAX_SIZE } = {}) {
    return selectedTrial?.provenance?.previewAnchor === true && position?.width >= 24 && position?.width <= previewEdgeCleanupMaxSize;
  }
  function isKnown48AnchorConfig(config, {
    known48EdgeCleanupMinSize = DEFAULT_KNOWN_48_EDGE_CLEANUP_MIN_SIZE,
    known48EdgeCleanupMaxSize = DEFAULT_KNOWN_48_EDGE_CLEANUP_MAX_SIZE
  } = {}) {
    if (!config || config.logoSize < known48EdgeCleanupMinSize || config.logoSize > known48EdgeCleanupMaxSize) {
      return false;
    }
    const marginRight = Number(config.marginRight);
    const marginBottom = Number(config.marginBottom);
    if (!Number.isFinite(marginRight) || !Number.isFinite(marginBottom)) return false;
    const isCurrentLargeMargin = Math.abs(marginRight - 96) <= 2 && Math.abs(marginBottom - 96) <= 2;
    const isCurrentStandardMargin = marginRight >= 28 && marginRight <= 36 && marginBottom >= 28 && marginBottom <= 36;
    return isCurrentLargeMargin || isCurrentStandardMargin;
  }
  function shouldUseKnown48EdgeCleanup({
    selectedTrial,
    position,
    source,
    known48EdgeCleanupMinSize = DEFAULT_KNOWN_48_EDGE_CLEANUP_MIN_SIZE,
    known48EdgeCleanupMaxSize = DEFAULT_KNOWN_48_EDGE_CLEANUP_MAX_SIZE
  } = {}) {
    if (selectedTrial?.provenance?.previewAnchor === true) return false;
    if (position?.width < known48EdgeCleanupMinSize || position?.width > known48EdgeCleanupMaxSize) return false;
    if (!isKnown48AnchorConfig(selectedTrial?.config, {
      known48EdgeCleanupMinSize,
      known48EdgeCleanupMaxSize
    })) return false;
    const sourceText = String(source || "");
    return sourceText === "standard" || sourceText.startsWith("standard+gain") || sourceText.includes("catalog") || sourceText.includes("fixed-local");
  }
  function isV2SmallAnchorConfig(config, { v2SmallEdgeCleanupSize = DEFAULT_V2_SMALL_EDGE_CLEANUP_SIZE } = {}) {
    if (!config || config.logoSize !== v2SmallEdgeCleanupSize || config.alphaVariant !== "v2") {
      return false;
    }
    const marginRight = Number(config.marginRight);
    const marginBottom = Number(config.marginBottom);
    return Number.isFinite(marginRight) && Number.isFinite(marginBottom) && marginRight >= 48 && marginBottom >= 48;
  }
  function shouldUseV2SmallEdgeCleanup({
    selectedTrial,
    position,
    source,
    v2SmallEdgeCleanupSize = DEFAULT_V2_SMALL_EDGE_CLEANUP_SIZE,
    v2SmallEdgeCleanupSizeTolerance = DEFAULT_V2_SMALL_EDGE_CLEANUP_SIZE_TOLERANCE
  } = {}) {
    if (selectedTrial?.provenance?.previewAnchor === true) return false;
    if (position?.width < v2SmallEdgeCleanupSize - v2SmallEdgeCleanupSizeTolerance || position?.width > v2SmallEdgeCleanupSize + v2SmallEdgeCleanupSizeTolerance) {
      return false;
    }
    if (!isV2SmallAnchorConfig(selectedTrial?.config, { v2SmallEdgeCleanupSize })) return false;
    if (selectedTrial?.provenance?.catalogFamily !== "gemini-v2-small") return false;
    const sourceText = String(source || "");
    return sourceText.includes("catalog");
  }
  function createRepairCleanupFlags({
    selectedTrial,
    position,
    source,
    previewEdgeCleanupMaxSize = DEFAULT_PREVIEW_EDGE_CLEANUP_MAX_SIZE,
    known48EdgeCleanupMinSize = DEFAULT_KNOWN_48_EDGE_CLEANUP_MIN_SIZE,
    known48EdgeCleanupMaxSize = DEFAULT_KNOWN_48_EDGE_CLEANUP_MAX_SIZE,
    v2SmallEdgeCleanupSize = DEFAULT_V2_SMALL_EDGE_CLEANUP_SIZE,
    v2SmallEdgeCleanupSizeTolerance = DEFAULT_V2_SMALL_EDGE_CLEANUP_SIZE_TOLERANCE
  } = {}) {
    return {
      usePreviewAnchorFastCleanup: shouldUsePreviewAnchorFastCleanup(selectedTrial, position, {
        previewEdgeCleanupMaxSize
      }),
      useKnown48EdgeCleanup: shouldUseKnown48EdgeCleanup({
        selectedTrial,
        position,
        source,
        known48EdgeCleanupMinSize,
        known48EdgeCleanupMaxSize
      }),
      useV2SmallEdgeCleanup: shouldUseV2SmallEdgeCleanup({
        selectedTrial,
        position,
        source,
        v2SmallEdgeCleanupSize,
        v2SmallEdgeCleanupSizeTolerance
      })
    };
  }

  // src/core/pipelineRuntimeBootstrap.js
  function createAcceptedPipelineRuntimeBootstrap({
    nowMs: nowMs2 = Date.now,
    acceptedPipelineState,
    selectedTrial,
    debugTimings = null,
    debugTimingsEnabled = false,
    cleanupConfig = {}
  } = {}) {
    const cleanupFlags = createRepairCleanupFlags({
      selectedTrial,
      position: acceptedPipelineState.position,
      source: acceptedPipelineState.source,
      previewEdgeCleanupMaxSize: cleanupConfig.previewEdgeCleanupMaxSize,
      known48EdgeCleanupMinSize: cleanupConfig.known48EdgeCleanupMinSize,
      known48EdgeCleanupMaxSize: cleanupConfig.known48EdgeCleanupMaxSize,
      v2SmallEdgeCleanupSize: cleanupConfig.v2SmallEdgeCleanupSize,
      v2SmallEdgeCleanupSizeTolerance: cleanupConfig.v2SmallEdgeCleanupSizeTolerance
    });
    const firstPassMetricsStartedAt = nowMs2();
    const firstPassMetrics = createFirstPassMetrics({
      imageData: acceptedPipelineState.finalImageData,
      alphaMap: acceptedPipelineState.alphaMap,
      position: acceptedPipelineState.position,
      originalSpatialScore: acceptedPipelineState.originalSpatialScore,
      originalGradientScore: acceptedPipelineState.originalGradientScore
    });
    if (debugTimingsEnabled && debugTimings) {
      debugTimings.firstPassMetricsMs = nowMs2() - firstPassMetricsStartedAt;
      debugTimings.extraPassMs = 0;
    }
    const passState = createFirstPassPipelinePassState({ firstPassMetrics });
    const finalMetricsStartedAt = nowMs2();
    const processedMetrics = createRegionCorrelationMetrics({
      imageData: acceptedPipelineState.finalImageData,
      alphaMap: acceptedPipelineState.alphaMap,
      position: acceptedPipelineState.position
    });
    if (debugTimingsEnabled && debugTimings) {
      debugTimings.finalMetricsMs = nowMs2() - finalMetricsStartedAt;
    }
    let pipelineState = createInitialPipelineRuntimeState({
      acceptedState: acceptedPipelineState,
      processedMetrics
    });
    const {
      readPipelineState,
      applyPipelineState
    } = createPipelineStateAccessors({
      get: () => pipelineState,
      set: (state) => {
        pipelineState = state;
      }
    });
    return {
      cleanupFlags,
      firstPassMetrics,
      processedMetrics,
      passState,
      readPipelineState,
      applyPipelineState
    };
  }

  // src/core/pipelineAlphaStageSpecs.js
  function readPipelineAlphaState(readState) {
    return typeof readState === "function" ? readState() : {};
  }
  function resolveNearBlackRatio({ calculateNearBlackRatio: calculateNearBlackRatio2, imageData, position }) {
    return typeof calculateNearBlackRatio2 === "function" ? calculateNearBlackRatio2(imageData, position) : 0;
  }
  function markTimingAnchor({ timingAnchors, timingKey, nowMs: nowMs2 }) {
    if (timingAnchors && timingKey) {
      timingAnchors[timingKey] = nowMs2();
    }
  }
  function createFineAlphaTrialSequenceSpecs({
    nowMs: nowMs2 = Date.now,
    readState,
    originalImageData,
    originalSpatialScore,
    originalGradientScore,
    calculateNearBlackRatio: calculateNearBlackRatio2,
    acceptCurrentAlphaTrialResult,
    debugTimings = null,
    debugTimingsEnabled = false,
    refiners = {}
  } = {}) {
    const {
      recalibrateOverSubtractedAlpha: recalibrateOverSubtractedAlpha2,
      fineTuneDarkCatalogAlpha: fineTuneDarkCatalogAlpha2,
      fineTuneWeakPositiveResidualAlpha: fineTuneWeakPositiveResidualAlpha2
    } = refiners;
    return [
      {
        stage: "over-subtraction-recalibration",
        strategy: "over-subtraction-fine-alpha",
        createTrial: () => {
          const state = readPipelineAlphaState(readState);
          return typeof recalibrateOverSubtractedAlpha2 === "function" ? recalibrateOverSubtractedAlpha2({
            originalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalNearBlackRatio: resolveNearBlackRatio({
              calculateNearBlackRatio: calculateNearBlackRatio2,
              imageData: originalImageData,
              position: state.position
            })
          }) : null;
        },
        acceptCurrentAlphaTrialResult,
        source: () => {
          const source = readPipelineAlphaState(readState).source;
          return source.includes("+gain") ? source : `${source}+gain`;
        },
        debugTimings,
        timingKey: debugTimingsEnabled ? "overSubtractionRecalibrationMs" : null,
        nowMs: nowMs2
      },
      {
        stage: "dark-catalog-fine-alpha",
        strategy: "dark-catalog-fine-alpha",
        createTrial: () => {
          const state = readPipelineAlphaState(readState);
          return typeof fineTuneDarkCatalogAlpha2 === "function" ? fineTuneDarkCatalogAlpha2({
            originalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            source: state.source,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore,
            originalNearBlackRatio: resolveNearBlackRatio({
              calculateNearBlackRatio: calculateNearBlackRatio2,
              imageData: originalImageData,
              position: state.position
            })
          }) : null;
        },
        acceptCurrentAlphaTrialResult,
        source: () => {
          const source = readPipelineAlphaState(readState).source;
          return source.includes("+fine-alpha") ? source : `${source}+fine-alpha`;
        },
        debugTimings,
        timingKey: debugTimingsEnabled ? "darkCatalogFineTuneMs" : null,
        nowMs: nowMs2
      },
      {
        stage: "weak-positive-residual-fine-alpha",
        strategy: "over-subtraction-fine-alpha",
        createTrial: () => {
          const state = readPipelineAlphaState(readState);
          return typeof fineTuneWeakPositiveResidualAlpha2 === "function" ? fineTuneWeakPositiveResidualAlpha2({
            originalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore,
            originalNearBlackRatio: resolveNearBlackRatio({
              calculateNearBlackRatio: calculateNearBlackRatio2,
              imageData: originalImageData,
              position: state.position
            })
          }) : null;
        },
        acceptCurrentAlphaTrialResult,
        source: () => {
          const source = readPipelineAlphaState(readState).source;
          return source.includes("+fine-alpha") ? source : `${source}+fine-alpha`;
        },
        debugTimings,
        timingKey: debugTimingsEnabled ? "weakAlphaFineTuneMs" : null,
        nowMs: nowMs2
      }
    ];
  }
  function createRecalibrationStageSpec({
    nowMs: nowMs2 = Date.now,
    readState,
    shouldRecalibrateAlphaStrength: shouldRecalibrateAlphaStrength2,
    calculateNearBlackRatio: calculateNearBlackRatio2,
    computeRegionGradientCorrelation: computeRegionGradientCorrelation2,
    acceptRecalibrationStageResult,
    debugTimings = null,
    debugTimingsEnabled = false,
    refiners = {}
  } = {}) {
    const {
      recalibrateAlphaStrength: recalibrateAlphaStrength2
    } = refiners;
    const state = readPipelineAlphaState(readState);
    return {
      shouldRun: typeof shouldRecalibrateAlphaStrength2 === "function" ? shouldRecalibrateAlphaStrength2({
        originalScore: state.originalSpatialScore,
        processedScore: state.finalProcessedSpatialScore,
        suppressionGain: state.suppressionGain
      }) : false,
      createRecalibration: () => {
        const current = readPipelineAlphaState(readState);
        return typeof recalibrateAlphaStrength2 === "function" ? recalibrateAlphaStrength2({
          sourceImageData: current.finalImageData,
          alphaMap: current.alphaMap,
          position: current.position,
          originalSpatialScore: current.originalSpatialScore,
          processedSpatialScore: current.finalProcessedSpatialScore,
          originalNearBlackRatio: resolveNearBlackRatio({
            calculateNearBlackRatio: calculateNearBlackRatio2,
            imageData: current.finalImageData,
            position: current.position
          })
        }) : null;
      },
      computeGradientScore: (recalibrated) => {
        const current = readPipelineAlphaState(readState);
        return typeof computeRegionGradientCorrelation2 === "function" ? computeRegionGradientCorrelation2({
          imageData: recalibrated.imageData,
          alphaMap: current.alphaMap,
          region: {
            x: current.position.x,
            y: current.position.y,
            size: current.position.width
          }
        }) : void 0;
      },
      acceptRecalibrationStageResult,
      debugTimings,
      timingKey: debugTimingsEnabled ? "recalibrationMs" : null,
      nowMs: nowMs2
    };
  }
  function createSmallAnchorAlphaStageSequenceSpecs({
    nowMs: nowMs2 = Date.now,
    timingAnchors = {},
    readState,
    originalImageData,
    originalGradientScore,
    alpha96,
    getAlphaMap,
    visualPostProcessingEnabled = false,
    assessWatermarkResidualVisibility: assessWatermarkResidualVisibility2,
    acceptCurrentAlphaStageResult,
    refiners = {}
  } = {}) {
    const {
      refineSmallPreviewAnchorCandidate: refineSmallPreviewAnchorCandidate2,
      refineSmallFixedLocalAnchorGeometry: refineSmallFixedLocalAnchorGeometry2
    } = refiners;
    markTimingAnchor({
      timingAnchors,
      timingKey: "smallPreviewRefinementStartedAt",
      nowMs: nowMs2
    });
    return [
      {
        stage: "small-preview-refinement",
        createStage: () => {
          const state = readPipelineAlphaState(readState);
          const refined = visualPostProcessingEnabled && typeof refineSmallPreviewAnchorCandidate2 === "function" ? refineSmallPreviewAnchorCandidate2({
            originalImageData,
            source: state.source,
            position: state.position,
            originalGradientScore,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            getAlphaMap
          }) : null;
          if (!refined) return null;
          const refinedPosition = refined.position;
          return {
            ...refined,
            config: {
              logoSize: refinedPosition.width,
              marginRight: originalImageData.width - refinedPosition.x - refinedPosition.width,
              marginBottom: originalImageData.height - refinedPosition.y - refinedPosition.height
            }
          };
        },
        acceptCurrentAlphaStageResult,
        source: () => `${readPipelineAlphaState(readState).source}+small-preview-refine`
      },
      {
        stage: "small-fixed-local-anchor-relocation",
        createStage: () => {
          const state = readPipelineAlphaState(readState);
          const currentResidualVisibility = typeof assessWatermarkResidualVisibility2 === "function" ? assessWatermarkResidualVisibility2({
            imageData: state.finalImageData,
            position: state.position,
            alphaMap: state.alphaMap
          }) : null;
          return typeof refineSmallFixedLocalAnchorGeometry2 === "function" ? refineSmallFixedLocalAnchorGeometry2({
            originalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSource: state.source,
            currentGradientScore: state.finalProcessedGradientScore,
            currentResidualVisibility,
            alpha96,
            getAlphaMap
          }) : null;
        },
        acceptCurrentAlphaStageResult,
        source: () => `${readPipelineAlphaState(readState).source}+small-anchor-relocated`,
        stageExtras: {
          allowSameAlphaGain: true
        }
      }
    ];
  }
  function createSubpixelOutlineAlphaStageSpecs({
    readState,
    calculateNearBlackRatio: calculateNearBlackRatio2,
    templateWarp = null,
    visualPostProcessingEnabled = false,
    usePreviewAnchorFastCleanup = false,
    outlineConfig = {},
    acceptCurrentAlphaStageResult,
    refiners = {}
  } = {}) {
    const {
      refineSubpixelOutline: refineSubpixelOutline2
    } = refiners;
    const {
      outlineRefinementThreshold,
      outlineRefinementMinGain,
      subpixelRefineShifts,
      subpixelRefineScales,
      minGradientImprovement = 0.04,
      maxSpatialDrift = 0.08
    } = outlineConfig;
    return [
      {
        stage: "subpixel-outline-refinement",
        createStage: () => {
          const state = readPipelineAlphaState(readState);
          if (!visualPostProcessingEnabled || usePreviewAnchorFastCleanup || state.finalProcessedSpatialScore > 0.3 || state.finalProcessedGradientScore < outlineRefinementThreshold) {
            return null;
          }
          const originalNearBlackRatio = resolveNearBlackRatio({
            calculateNearBlackRatio: calculateNearBlackRatio2,
            imageData: state.finalImageData,
            position: state.position
          });
          const baselineShift = templateWarp ?? { dx: 0, dy: 0, scale: 1 };
          return typeof refineSubpixelOutline2 === "function" ? refineSubpixelOutline2({
            sourceImageData: state.finalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            alphaGain: state.alphaGain,
            originalNearBlackRatio,
            baselineSpatialScore: state.finalProcessedSpatialScore,
            baselineGradientScore: state.finalProcessedGradientScore,
            baselineShift,
            minGain: outlineRefinementMinGain,
            shiftCandidates: subpixelRefineShifts,
            scaleCandidates: subpixelRefineScales,
            minGradientImprovement,
            maxSpatialDrift
          }) : null;
        },
        acceptCurrentAlphaStageResult,
        source: () => `${readPipelineAlphaState(readState).source}+subpixel`,
        suppressionGain: null
      }
    ];
  }
  function createLocatedAggressiveStageSpec({
    readState,
    originalImageData,
    originalSpatialScore,
    originalGradientScore,
    smallFixedLocalRelocated,
    locatedAggressiveRemovalEnabled = true,
    assessWatermarkResidualVisibility: assessWatermarkResidualVisibility2,
    shouldSkipLocatedAggressiveForCleanCanonical96: shouldSkipLocatedAggressiveForCleanCanonical962,
    recordAlphaTrialEvent,
    acceptLocatedAggressiveResult,
    currentPassState,
    refiners = {}
  } = {}) {
    const {
      refineLocatedAggressiveRemoval: refineLocatedAggressiveRemoval2
    } = refiners;
    const state = readPipelineAlphaState(readState);
    const locatedAggressiveResidualVisibility = typeof assessWatermarkResidualVisibility2 === "function" ? assessWatermarkResidualVisibility2({
      imageData: state.finalImageData,
      position: state.position,
      alphaMap: state.alphaMap
    }) : null;
    const baseShouldRun = locatedAggressiveRemovalEnabled !== false && smallFixedLocalRelocated?.residualVisibility?.visible !== false && locatedAggressiveResidualVisibility?.visible !== false;
    const skipCleanCanonical96 = baseShouldRun && typeof shouldSkipLocatedAggressiveForCleanCanonical962 === "function" ? shouldSkipLocatedAggressiveForCleanCanonical962({
      config: state.config,
      alphaGain: state.alphaGain,
      originalSpatialScore,
      originalGradientScore,
      currentSpatialScore: state.finalProcessedSpatialScore,
      currentGradientScore: state.finalProcessedGradientScore
    }) : false;
    return {
      shouldRun: baseShouldRun && !skipCleanCanonical96,
      createStage: ({ onRejected } = {}) => {
        const current = readPipelineAlphaState(readState);
        return typeof refineLocatedAggressiveRemoval2 === "function" ? refineLocatedAggressiveRemoval2({
          originalImageData,
          currentImageData: current.finalImageData,
          alphaMap: current.alphaMap,
          position: current.position,
          currentSpatialScore: current.finalProcessedSpatialScore,
          currentGradientScore: current.finalProcessedGradientScore,
          currentAlphaGain: current.alphaGain,
          onRejected
        }) : null;
      },
      recordAlphaTrialEvent,
      acceptLocatedAggressiveResult,
      currentPassState,
      source: () => {
        const currentSource = readPipelineAlphaState(readState).source;
        return currentSource.includes("+located-aggressive") ? currentSource : `${currentSource}+located-aggressive`;
      },
      fromAlphaGain: state.alphaGain,
      beforeSpatialScore: state.finalProcessedSpatialScore,
      beforeGradientScore: state.finalProcessedGradientScore,
      originalSpatialScore
    };
  }
  function markAlphaRescueTimingAnchors({
    timingAnchors,
    nowMs: nowMs2,
    resolveVariantAlphaMap
  }) {
    if (!timingAnchors) {
      return typeof resolveVariantAlphaMap === "function" ? resolveVariantAlphaMap() : null;
    }
    timingAnchors.newMargin96VariantRescueStartedAt = nowMs2();
    const variantAlphaMap = typeof resolveVariantAlphaMap === "function" ? resolveVariantAlphaMap() : null;
    timingAnchors.known48AntiTemplateRescueStartedAt = nowMs2();
    timingAnchors.powerProfileRescueStartedAt = nowMs2();
    timingAnchors.positiveResidualRebalanceStartedAt = nowMs2();
    return variantAlphaMap;
  }
  function createAlphaRescueStageSequenceSpecs({
    nowMs: nowMs2 = Date.now,
    timingAnchors = {},
    readState,
    originalImageData,
    originalSpatialScore,
    originalGradientScore,
    resolveVariantAlphaMap,
    acceptCurrentAlphaStageResult,
    refiners = {}
  } = {}) {
    const {
      refineNewMargin96VariantResidual: refineNewMargin96VariantResidual2,
      refineKnown48AntiTemplateResidual: refineKnown48AntiTemplateResidual2,
      refineKnown48PowerProfileResidual: refineKnown48PowerProfileResidual2,
      refineKnown48PositiveResidualRebalance: refineKnown48PositiveResidualRebalance2
    } = refiners;
    const variantAlphaMap = markAlphaRescueTimingAnchors({
      timingAnchors,
      nowMs: nowMs2,
      resolveVariantAlphaMap
    });
    return [
      {
        stage: "new-margin-96-variant-rescue",
        strategy: "new-margin-96-variant",
        createStage: () => {
          const state = readPipelineAlphaState(readState);
          return typeof refineNewMargin96VariantResidual2 === "function" ? refineNewMargin96VariantResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            originalSpatialScore,
            originalGradientScore,
            variantAlphaMap
          }) : null;
        },
        acceptCurrentAlphaStageResult,
        source: () => `${readPipelineAlphaState(readState).source}+new-margin-variant`,
        stageExtras: (result) => ({
          profileExponent: result.profileExponent
        })
      },
      {
        stage: "known-48-anti-template-rescue",
        createStage: () => {
          const state = readPipelineAlphaState(readState);
          return typeof refineKnown48AntiTemplateResidual2 === "function" ? refineKnown48AntiTemplateResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore
          }) : null;
        },
        acceptCurrentAlphaStageResult,
        source: () => `${readPipelineAlphaState(readState).source}+anti-template-rescue`,
        stageExtras: {
          allowSameAlphaGain: true
        }
      },
      {
        stage: "known-48-power-profile-rescue",
        strategy: "known-48-power-profile",
        createStage: () => {
          const state = readPipelineAlphaState(readState);
          return typeof refineKnown48PowerProfileResidual2 === "function" ? refineKnown48PowerProfileResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore
          }) : null;
        },
        acceptCurrentAlphaStageResult,
        source: () => `${readPipelineAlphaState(readState).source}+power-profile-rescue`,
        stageExtras: (result) => ({
          profileExponent: result.profileExponent,
          allowSameAlphaGain: true
        })
      },
      {
        stage: "known-48-positive-residual-rebalance",
        strategy: "known-48-positive-residual-rebalance",
        createStage: () => {
          const state = readPipelineAlphaState(readState);
          return typeof refineKnown48PositiveResidualRebalance2 === "function" ? refineKnown48PositiveResidualRebalance2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore
          }) : null;
        },
        acceptCurrentAlphaStageResult,
        source: () => `${readPipelineAlphaState(readState).source}+residual-rebalance`,
        stageExtras: (result) => ({
          profileExponent: result.profileExponent,
          allowSameAlphaGain: true
        })
      }
    ];
  }

  // src/core/pipelineTimings.js
  function createTailDebugTimings({
    nowMs: nowMs2,
    totalStartedAt,
    previewEdgeCleanupElapsedMs = 0,
    smallPreviewRefinementStartedAt,
    locatedAggressiveStartedAt,
    smoothPriorStartedAt,
    newMargin96VariantRescueStartedAt,
    known48AntiTemplateRescueStartedAt,
    powerProfileRescueStartedAt,
    positiveResidualRebalanceStartedAt,
    smallMarginPriorRepairStartedAt,
    smallLocatedPriorRepairStartedAt,
    boundaryRepairRescueStartedAt,
    darkHaloRescueStartedAt,
    quantizedBodyCorrectionStartedAt,
    midCoreBiasStartedAt
  } = {}) {
    return {
      previewEdgeCleanupMs: previewEdgeCleanupElapsedMs,
      smallPreviewRefinementMs: nowMs2() - smallPreviewRefinementStartedAt,
      locatedAggressiveRemovalMs: nowMs2() - locatedAggressiveStartedAt,
      smoothPriorCleanupMs: nowMs2() - smoothPriorStartedAt,
      newMargin96VariantRescueMs: known48AntiTemplateRescueStartedAt - newMargin96VariantRescueStartedAt,
      known48AntiTemplateRescueMs: powerProfileRescueStartedAt - known48AntiTemplateRescueStartedAt,
      powerProfileRescueMs: positiveResidualRebalanceStartedAt - powerProfileRescueStartedAt,
      positiveResidualRebalanceMs: smallMarginPriorRepairStartedAt - positiveResidualRebalanceStartedAt,
      smallMarginPriorRepairMs: smallLocatedPriorRepairStartedAt - smallMarginPriorRepairStartedAt,
      smallLocatedPriorRepairMs: boundaryRepairRescueStartedAt - smallLocatedPriorRepairStartedAt,
      boundaryRepairRescueMs: darkHaloRescueStartedAt - boundaryRepairRescueStartedAt,
      darkHaloRescueMs: quantizedBodyCorrectionStartedAt - darkHaloRescueStartedAt,
      quantizedBodyCorrectionMs: midCoreBiasStartedAt - quantizedBodyCorrectionStartedAt,
      midCoreBiasCorrectionMs: nowMs2() - midCoreBiasStartedAt,
      totalMs: nowMs2() - totalStartedAt
    };
  }

  // src/core/pipelineRuntime.js
  function runCurrentAlphaTrialStage({
    stage,
    strategy,
    createTrial,
    acceptCurrentAlphaTrialResult,
    source,
    debugTimings = null,
    timingKey = null,
    nowMs: nowMs2 = Date.now
  } = {}) {
    const startedAt = nowMs2();
    const result = typeof createTrial === "function" ? createTrial() : null;
    if (result && typeof acceptCurrentAlphaTrialResult === "function") {
      acceptCurrentAlphaTrialResult({
        stage,
        strategy,
        result,
        source: typeof source === "function" ? source(result) : source
      });
    }
    if (debugTimings && timingKey) {
      debugTimings[timingKey] = nowMs2() - startedAt;
    }
    return result;
  }
  function runCurrentAlphaTrialSequence({
    stages = []
  } = {}) {
    const results = [];
    for (const stage of stages) {
      results.push(runCurrentAlphaTrialStage(stage));
    }
    return results;
  }
  function runCurrentAlphaTrialSpecPhase({
    createSpecs
  } = {}) {
    return runCurrentAlphaTrialSequence({
      stages: typeof createSpecs === "function" ? createSpecs() : []
    });
  }
  function resolveStageValue(value, result) {
    return typeof value === "function" ? value(result) : value;
  }
  function runCurrentAlphaStage({
    stage,
    strategy = null,
    createStage,
    acceptCurrentAlphaStageResult,
    source,
    suppressionGain,
    stageExtras
  } = {}) {
    const result = typeof createStage === "function" ? createStage() : null;
    if (result && typeof acceptCurrentAlphaStageResult === "function") {
      acceptCurrentAlphaStageResult({
        stage,
        strategy,
        result,
        source: resolveStageValue(source, result),
        suppressionGain: resolveStageValue(suppressionGain, result),
        stageExtras: resolveStageValue(stageExtras, result)
      });
    }
    return result;
  }
  function runCurrentAlphaStageSequence({
    stages = []
  } = {}) {
    const results = [];
    for (const stage of stages) {
      results.push(runCurrentAlphaStage(stage));
    }
    return results;
  }
  function runCurrentAlphaStageSpecPhase({
    createSpecs
  } = {}) {
    return runCurrentAlphaStageSequence({
      stages: typeof createSpecs === "function" ? createSpecs() : []
    });
  }
  function runCurrentRepairStage({
    stage,
    strategy,
    createStage,
    acceptCurrentRepairTrialResult,
    source,
    suppressionGain,
    deriveSuppressionGainFromOriginalSpatial = false,
    stageExtras
  } = {}) {
    const result = typeof createStage === "function" ? createStage() : null;
    if (result && typeof acceptCurrentRepairTrialResult === "function") {
      acceptCurrentRepairTrialResult({
        stage,
        strategy,
        result,
        source: resolveStageValue(source, result),
        suppressionGain: resolveStageValue(suppressionGain, result),
        deriveSuppressionGainFromOriginalSpatial,
        stageExtras: resolveStageValue(stageExtras, result)
      });
    }
    return result;
  }
  function runCurrentRepairStageSequence({
    stages = []
  } = {}) {
    const results = [];
    for (const stage of stages) {
      if (typeof stage?.beforeStage === "function") {
        stage.beforeStage(stage);
      }
      results.push(runCurrentRepairStage(stage));
    }
    return results;
  }
  function runCurrentRepairStageSpecPhase({
    createSpecs
  } = {}) {
    return runCurrentRepairStageSequence({
      stages: typeof createSpecs === "function" ? createSpecs() : []
    });
  }
  function runRepairCleanupSpecPhase({
    createSpecs
  } = {}) {
    const specs = typeof createSpecs === "function" ? createSpecs() : {};
    let previewEdgeCleanupElapsedMs = 0;
    if (specs.edgeCleanup) {
      const outcome = runRepeatedCurrentRepairStage(specs.edgeCleanup);
      previewEdgeCleanupElapsedMs = outcome.elapsedMs;
    }
    if (specs.known48FlatFill) {
      runRepeatedCurrentRepairStage(specs.known48FlatFill);
    }
    if (specs.known48LumaEdge) {
      runCurrentRepairStage(specs.known48LumaEdge);
    }
    if (specs.newMargin96FlatFill) {
      runCurrentRepairStage(specs.newMargin96FlatFill);
    }
    return {
      previewEdgeCleanupElapsedMs
    };
  }
  function runRepeatedCurrentRepairStage({
    maxPasses = 1,
    createStage,
    acceptCurrentRepairTrialResult,
    stage,
    strategy,
    source,
    suppressionGain,
    deriveSuppressionGainFromOriginalSpatial = false,
    stageExtras,
    nowMs: nowMs2 = null
  } = {}) {
    let passCount = 0;
    let elapsedMs = 0;
    const shouldMeasure = typeof nowMs2 === "function";
    while (passCount < maxPasses) {
      const startedAt = shouldMeasure ? nowMs2() : 0;
      const result = typeof createStage === "function" ? createStage(passCount) : null;
      if (shouldMeasure) {
        elapsedMs += nowMs2() - startedAt;
      }
      if (!result) {
        break;
      }
      if (typeof acceptCurrentRepairTrialResult === "function") {
        acceptCurrentRepairTrialResult({
          stage: resolveStageValue(stage, result),
          strategy: resolveStageValue(strategy, result),
          result,
          source: resolveStageValue(source, result),
          suppressionGain: resolveStageValue(suppressionGain, result),
          deriveSuppressionGainFromOriginalSpatial,
          stageExtras: resolveStageValue(stageExtras, result)
        });
      }
      passCount++;
    }
    return {
      passCount,
      elapsedMs
    };
  }
  function runPreviewBackgroundCleanupStage({
    createCleanup,
    acceptPreviewBackgroundCleanupResult,
    debugTimings = null,
    timingKey = null,
    nowMs: nowMs2 = Date.now
  } = {}) {
    const startedAt = nowMs2();
    const cleanup = typeof createCleanup === "function" ? createCleanup() : null;
    if (cleanup && typeof acceptPreviewBackgroundCleanupResult === "function") {
      acceptPreviewBackgroundCleanupResult(cleanup);
    }
    if (debugTimings && timingKey) {
      debugTimings[timingKey] = nowMs2() - startedAt;
    }
    return cleanup;
  }
  function runRecalibrationStage({
    shouldRun = true,
    createRecalibration,
    computeGradientScore,
    acceptRecalibrationStageResult,
    debugTimings = null,
    timingKey = null,
    nowMs: nowMs2 = Date.now
  } = {}) {
    const startedAt = nowMs2();
    const result = shouldRun && typeof createRecalibration === "function" ? createRecalibration() : null;
    if (result && typeof acceptRecalibrationStageResult === "function") {
      acceptRecalibrationStageResult({
        result,
        gradientScore: typeof computeGradientScore === "function" ? computeGradientScore(result) : void 0
      });
    }
    if (debugTimings && timingKey) {
      debugTimings[timingKey] = nowMs2() - startedAt;
    }
    return result;
  }
  function runLocatedAggressiveStage({
    shouldRun = true,
    createStage,
    recordAlphaTrialEvent,
    acceptLocatedAggressiveResult,
    currentPassState,
    source,
    fromAlphaGain,
    beforeSpatialScore,
    beforeGradientScore,
    originalSpatialScore
  } = {}) {
    if (!shouldRun) {
      return {
        result: null,
        passState: currentPassState
      };
    }
    const result = typeof createStage === "function" ? createStage({
      onRejected: (event) => {
        if (typeof recordAlphaTrialEvent === "function") {
          recordAlphaTrialEvent({
            ...event,
            decision: "reject"
          });
        }
      }
    }) : null;
    if (!result || typeof acceptLocatedAggressiveResult !== "function") {
      return {
        result,
        passState: currentPassState
      };
    }
    const aggressiveOutcome = acceptLocatedAggressiveResult({
      result,
      source: resolveStageValue(source, result),
      fromAlphaGain,
      beforeSpatialScore,
      beforeGradientScore,
      originalSpatialScore,
      passes: currentPassState?.passes
    });
    return {
      result,
      outcome: aggressiveOutcome,
      passState: applyPipelinePassOutcome({
        current: currentPassState,
        outcome: aggressiveOutcome
      })
    };
  }
  function createAlphaRepairPipelineRuntime({
    traceRecorder,
    readState,
    applyState,
    debugTimings = null
  } = {}) {
    const recordAlphaAdjustmentStage = traceRecorder?.recordAlphaAdjustmentStage;
    const recordAlphaTrialEvent = traceRecorder?.recordAlphaTrialEvent;
    const safeRecordAlphaAdjustmentStage = typeof recordAlphaAdjustmentStage === "function" ? recordAlphaAdjustmentStage : () => {
    };
    const safeRecordAlphaTrialEvent = typeof recordAlphaTrialEvent === "function" ? recordAlphaTrialEvent : () => {
    };
    const commitPipelineResult = ({ result, source } = {}) => {
      const committedState = createPipelineStateCommit({
        current: readState(),
        result,
        source
      });
      applyState(committedState);
      return committedState;
    };
    return {
      alphaAdjustmentStages: traceRecorder?.alphaAdjustmentStages ?? [],
      alphaTrialEvents: traceRecorder?.alphaTrialEvents ?? [],
      recordAlphaAdjustmentStage: safeRecordAlphaAdjustmentStage,
      recordAlphaTrialEvent: safeRecordAlphaTrialEvent,
      commitPipelineResult,
      acceptCurrentAlphaStageResult({
        stage,
        strategy = null,
        result,
        source,
        suppressionGain = result?.suppressionGain,
        stageExtras = {}
      } = {}) {
        const current = readState();
        safeRecordAlphaAdjustmentStage({
          stage,
          fromAlphaGain: current?.alphaGain,
          toAlphaGain: result?.alphaGain,
          beforeSpatialScore: current?.finalProcessedSpatialScore,
          beforeGradientScore: current?.finalProcessedGradientScore,
          afterSpatialScore: result?.spatialScore,
          afterGradientScore: result?.gradientScore,
          suppressionGain,
          cost: result?.cost,
          alphaStrategy: strategy,
          ...stageExtras
        });
        return commitPipelineResult({ result, source });
      },
      acceptCurrentRepairTrialResult({
        stage,
        strategy,
        result,
        source,
        suppressionGain = result?.suppressionGain,
        deriveSuppressionGainFromOriginalSpatial = false,
        stageExtras = {}
      } = {}) {
        const current = readState();
        const resolvedSuppressionGain = deriveSuppressionGainFromOriginalSpatial ? current?.originalSpatialScore - result?.spatialScore : suppressionGain;
        safeRecordAlphaAdjustmentStage({
          stage,
          fromAlphaGain: current?.alphaGain,
          toAlphaGain: result?.alphaGain ?? current?.alphaGain,
          beforeSpatialScore: current?.finalProcessedSpatialScore,
          beforeGradientScore: current?.finalProcessedGradientScore,
          afterSpatialScore: result?.spatialScore,
          afterGradientScore: result?.gradientScore,
          suppressionGain: resolvedSuppressionGain,
          cost: result?.cost,
          repairStrategy: strategy,
          allowSameAlphaGain: true,
          ...stageExtras
        });
        return commitPipelineResult({ result, source });
      },
      acceptRecalibrationStageResult({
        result,
        gradientScore
      } = {}) {
        const current = readState();
        const committedResult = {
          ...result,
          gradientScore
        };
        safeRecordAlphaAdjustmentStage({
          stage: "recalibration",
          fromAlphaGain: current?.alphaGain,
          toAlphaGain: result?.alphaGain,
          beforeSpatialScore: current?.finalProcessedSpatialScore,
          beforeGradientScore: current?.finalProcessedGradientScore,
          afterSpatialScore: result?.processedSpatialScore,
          afterGradientScore: gradientScore,
          suppressionGain: result?.suppressionGain,
          cost: result?.cost,
          alphaStrategy: null
        });
        return commitPipelineResult({
          result: committedResult,
          source: current?.source === "adaptive" ? "adaptive+gain" : `${current?.source}+gain`
        });
      },
      acceptCurrentAlphaTrialResult({
        stage,
        strategy,
        result,
        source,
        suppressionGain = result?.suppressionGain,
        stageExtras = {},
        eventExtras = {}
      } = {}) {
        const current = readState();
        const toAlphaGain = result?.alphaGain;
        const alphaEvent = {
          stage,
          strategy,
          decision: "accept",
          fromAlphaGain: current?.alphaGain,
          toAlphaGain,
          alphaGain: toAlphaGain,
          beforeSpatialScore: current?.finalProcessedSpatialScore,
          beforeGradientScore: current?.finalProcessedGradientScore,
          afterSpatialScore: result?.spatialScore,
          afterGradientScore: result?.gradientScore,
          suppressionGain,
          cost: result?.cost,
          ...eventExtras
        };
        const alphaStage = {
          stage,
          fromAlphaGain: current?.alphaGain,
          toAlphaGain,
          beforeSpatialScore: current?.finalProcessedSpatialScore,
          beforeGradientScore: current?.finalProcessedGradientScore,
          afterSpatialScore: result?.spatialScore,
          afterGradientScore: result?.gradientScore,
          suppressionGain,
          cost: result?.cost,
          alphaStrategy: strategy,
          ...stageExtras
        };
        safeRecordAlphaAdjustmentStage(alphaStage);
        safeRecordAlphaTrialEvent(alphaEvent);
        return commitPipelineResult({ result, source });
      },
      acceptAlphaTrialResult({
        stage,
        strategy,
        result,
        source,
        fromAlphaGain,
        beforeSpatialScore,
        beforeGradientScore,
        afterSpatialScore = result?.spatialScore,
        afterGradientScore = result?.gradientScore,
        suppressionGain = result?.suppressionGain,
        cost = result?.cost,
        stageExtras = {},
        eventExtras = {}
      } = {}) {
        const toAlphaGain = result?.alphaGain;
        const alphaEvent = {
          stage,
          strategy,
          decision: "accept",
          fromAlphaGain,
          toAlphaGain,
          alphaGain: toAlphaGain,
          beforeSpatialScore,
          beforeGradientScore,
          afterSpatialScore,
          afterGradientScore,
          suppressionGain,
          cost,
          ...eventExtras
        };
        const alphaStage = {
          stage,
          fromAlphaGain,
          toAlphaGain,
          beforeSpatialScore,
          beforeGradientScore,
          afterSpatialScore,
          afterGradientScore,
          suppressionGain,
          cost,
          alphaStrategy: strategy,
          ...stageExtras
        };
        safeRecordAlphaAdjustmentStage(alphaStage);
        safeRecordAlphaTrialEvent(alphaEvent);
        return commitPipelineResult({ result, source });
      },
      acceptAlphaStageResult({
        stage,
        strategy = null,
        result,
        source,
        fromAlphaGain,
        toAlphaGain = result?.alphaGain,
        beforeSpatialScore,
        beforeGradientScore,
        afterSpatialScore = result?.spatialScore,
        afterGradientScore = result?.gradientScore,
        suppressionGain = result?.suppressionGain,
        cost = result?.cost,
        stageExtras = {}
      } = {}) {
        safeRecordAlphaAdjustmentStage({
          stage,
          fromAlphaGain,
          toAlphaGain,
          beforeSpatialScore,
          beforeGradientScore,
          afterSpatialScore,
          afterGradientScore,
          suppressionGain,
          cost,
          alphaStrategy: strategy,
          ...stageExtras
        });
        return commitPipelineResult({ result, source });
      },
      acceptRepairTrialResult({
        stage,
        strategy,
        result,
        source,
        fromAlphaGain,
        toAlphaGain = result?.alphaGain ?? fromAlphaGain,
        beforeSpatialScore,
        beforeGradientScore,
        afterSpatialScore = result?.spatialScore,
        afterGradientScore = result?.gradientScore,
        suppressionGain = result?.suppressionGain,
        cost = result?.cost,
        stageExtras = {}
      } = {}) {
        safeRecordAlphaAdjustmentStage({
          stage,
          fromAlphaGain,
          toAlphaGain,
          beforeSpatialScore,
          beforeGradientScore,
          afterSpatialScore,
          afterGradientScore,
          suppressionGain,
          cost,
          repairStrategy: strategy,
          allowSameAlphaGain: true,
          ...stageExtras
        });
        return commitPipelineResult({ result, source });
      },
      acceptLocatedAggressiveResult({
        result,
        source,
        fromAlphaGain,
        beforeSpatialScore,
        beforeGradientScore,
        originalSpatialScore,
        passes
      } = {}) {
        const suppressionGain = originalSpatialScore - result.spatialScore;
        safeRecordAlphaAdjustmentStage({
          stage: "located-aggressive-removal",
          fromAlphaGain,
          toAlphaGain: result.alphaGain,
          beforeSpatialScore,
          beforeGradientScore,
          afterSpatialScore: result.spatialScore,
          afterGradientScore: result.gradientScore,
          suppressionGain,
          cost: result.cost,
          alphaStrategy: "located-aggressive-alpha",
          allowSameAlphaGain: true
        });
        safeRecordAlphaTrialEvent({
          strategy: "located-aggressive-alpha",
          decision: "accept",
          blockedGate: null,
          beforeSpatialScore,
          beforeGradientScore,
          afterSpatialScore: result.spatialScore,
          afterGradientScore: result.gradientScore,
          suppressionGain,
          alphaGain: result.alphaGain,
          repeatCount: result.repeatCount,
          edgeCleanup: result.edgeCleanup === true,
          cost: result.cost
        });
        if (Array.isArray(passes)) {
          passes.push({
            index: passes.length + 1,
            beforeSpatialScore,
            beforeGradientScore,
            afterSpatialScore: result.spatialScore,
            afterGradientScore: result.gradientScore,
            improvement: Math.abs(beforeSpatialScore) - Math.abs(result.spatialScore),
            gradientDelta: result.gradientScore - beforeGradientScore,
            nearBlackRatio: result.nearBlackRatio
          });
        }
        return {
          committedState: commitPipelineResult({ result, source }),
          passIncrement: Math.max(1, result.repeatCount || 1),
          passStopReason: result.edgeCleanup ? "located-aggressive-edge-cleanup" : "located-aggressive-alpha"
        };
      },
      acceptPreviewBackgroundCleanupResult({
        cleanedImageData,
        source,
        cleanedSpatialScore,
        cleanedGradientScore,
        cleanedNearBlackRatio,
        currentNearBlackRatio,
        baselineSpatialScore,
        maxNearBlackRatioIncrease
      } = {}) {
        if (Math.abs(cleanedSpatialScore) > Math.abs(baselineSpatialScore) || cleanedNearBlackRatio > currentNearBlackRatio + maxNearBlackRatioIncrease) {
          return null;
        }
        return commitPipelineResult({
          result: {
            imageData: cleanedImageData,
            spatialScore: cleanedSpatialScore,
            gradientScore: cleanedGradientScore
          },
          source
        });
      },
      assignTailDebugTimings(timingInput = {}) {
        if (!debugTimings) return null;
        Object.assign(debugTimings, createTailDebugTimings(timingInput));
        return debugTimings;
      }
    };
  }

  // src/core/pipelineRepairStageSpecs.js
  function readPipelineRepairState(readState) {
    return typeof readState === "function" ? readState() : {};
  }
  function markTimingAnchor2({ timingAnchors, timingKey, nowMs: nowMs2 }) {
    return () => {
      if (timingAnchors && timingKey) {
        timingAnchors[timingKey] = nowMs2();
      }
    };
  }
  function createPreviewBackgroundCleanupStageSpec({
    nowMs: nowMs2 = Date.now,
    readState,
    visualPostProcessingEnabled = false,
    maxNearBlackRatioIncrease,
    measureOuterBorderLuminanceStd: measureOuterBorderLuminanceStd2,
    shouldApplyPreviewSmoothBackgroundCleanup: shouldApplyPreviewSmoothBackgroundCleanup2,
    applyPreviewSmoothBackgroundCleanup: applyPreviewSmoothBackgroundCleanup2,
    createRegionCorrelationMetrics: createRegionCorrelationMetrics2,
    calculateNearBlackRatio: calculateNearBlackRatio2,
    acceptPreviewBackgroundCleanupResult,
    debugTimings = null,
    debugTimingsEnabled = false
  } = {}) {
    return {
      createCleanup: () => {
        const state = readPipelineRepairState(readState);
        const previewBackgroundBorderStd = visualPostProcessingEnabled && typeof measureOuterBorderLuminanceStd2 === "function" ? measureOuterBorderLuminanceStd2(state.finalImageData, state.position) : 0;
        const shouldApply = typeof shouldApplyPreviewSmoothBackgroundCleanup2 === "function" ? shouldApplyPreviewSmoothBackgroundCleanup2({
          enabled: visualPostProcessingEnabled,
          source: state.source,
          position: state.position,
          baselineSpatialScore: state.finalProcessedSpatialScore,
          borderStd: previewBackgroundBorderStd
        }) : false;
        if (!shouldApply) {
          return null;
        }
        const cleaned = typeof applyPreviewSmoothBackgroundCleanup2 === "function" ? applyPreviewSmoothBackgroundCleanup2({
          imageData: state.finalImageData,
          position: state.position
        }) : null;
        if (!cleaned) {
          return null;
        }
        const cleanedMetrics = typeof createRegionCorrelationMetrics2 === "function" ? createRegionCorrelationMetrics2({
          imageData: cleaned.imageData,
          alphaMap: state.alphaMap,
          position: state.position,
          includeNearBlackRatio: true
        }) : {};
        return {
          cleanedImageData: cleaned.imageData,
          source: `${state.source}+background-cleanup`,
          cleanedSpatialScore: cleanedMetrics.spatialScore,
          cleanedGradientScore: cleanedMetrics.gradientScore,
          cleanedNearBlackRatio: cleanedMetrics.nearBlackRatio,
          currentNearBlackRatio: typeof calculateNearBlackRatio2 === "function" ? calculateNearBlackRatio2(state.finalImageData, state.position) : void 0,
          baselineSpatialScore: state.finalProcessedSpatialScore,
          maxNearBlackRatioIncrease
        };
      },
      acceptPreviewBackgroundCleanupResult,
      debugTimings,
      timingKey: debugTimingsEnabled ? "previewBackgroundCleanupMs" : null,
      nowMs: nowMs2
    };
  }
  function createRepairCleanupPhaseSpecs({
    nowMs: nowMs2 = Date.now,
    readState,
    shouldRunEdgeCleanup = false,
    useKnown48EdgeCleanup = false,
    useV2SmallEdgeCleanup = false,
    usePreviewAnchorFastCleanup = false,
    cleanupConfig = {},
    acceptCurrentRepairTrialResult,
    refiners = {}
  } = {}) {
    const {
      refinePreviewResidualEdge: refinePreviewResidualEdge2,
      refineKnown48FlatBackgroundResidual: refineKnown48FlatBackgroundResidual2,
      refineKnown48LumaEdgeResidual: refineKnown48LumaEdgeResidual2,
      refineNewMargin96FlatBackgroundResidual: refineNewMargin96FlatBackgroundResidual2
    } = refiners;
    const {
      previewEdgeCleanupMaxAppliedPasses = 1,
      previewEdgeCleanupMinGradientImprovement,
      previewEdgeCleanupMaxSpatialDrift,
      known48EdgeCleanupMinGradientImprovement,
      known48EdgeCleanupMaxSpatialDrift,
      v2SmallEdgeCleanupMinGradientImprovement,
      v2SmallEdgeCleanupMaxSpatialDrift,
      known48FlatFillMaxAppliedPasses = 1,
      known48FlatFillMinGradientImprovement,
      known48FlatFillSecondPassMinGradientImprovement
    } = cleanupConfig;
    return {
      edgeCleanup: shouldRunEdgeCleanup ? {
        maxPasses: previewEdgeCleanupMaxAppliedPasses,
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refinePreviewResidualEdge2 === "function" ? refinePreviewResidualEdge2({
            sourceImageData: state.finalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            source: state.source,
            baselineSpatialScore: state.finalProcessedSpatialScore,
            baselineGradientScore: state.finalProcessedGradientScore,
            minGradientImprovement: useKnown48EdgeCleanup ? known48EdgeCleanupMinGradientImprovement : useV2SmallEdgeCleanup ? v2SmallEdgeCleanupMinGradientImprovement : previewEdgeCleanupMinGradientImprovement,
            maxSpatialDrift: useKnown48EdgeCleanup ? known48EdgeCleanupMaxSpatialDrift : useV2SmallEdgeCleanup ? v2SmallEdgeCleanupMaxSpatialDrift : previewEdgeCleanupMaxSpatialDrift,
            allowAggressivePresets: usePreviewAnchorFastCleanup,
            mode: useKnown48EdgeCleanup ? "known-48" : useV2SmallEdgeCleanup ? "v2-small" : "preview"
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        stage: () => useV2SmallEdgeCleanup ? "v2-small-edge-cleanup" : useKnown48EdgeCleanup ? "known-48-edge-cleanup" : "preview-edge-cleanup",
        strategy: "edge-cleanup",
        source: () => {
          const source = readPipelineRepairState(readState).source;
          return `${source}+${useV2SmallEdgeCleanup ? "v2-small-edge-cleanup" : "edge-cleanup"}`;
        },
        deriveSuppressionGainFromOriginalSpatial: true,
        nowMs: nowMs2
      } : null,
      known48FlatFill: useKnown48EdgeCleanup ? {
        maxPasses: known48FlatFillMaxAppliedPasses,
        createStage: (passIndex) => {
          const state = readPipelineRepairState(readState);
          return typeof refineKnown48FlatBackgroundResidual2 === "function" ? refineKnown48FlatBackgroundResidual2({
            sourceImageData: state.finalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            baselineSpatialScore: state.finalProcessedSpatialScore,
            baselineGradientScore: state.finalProcessedGradientScore,
            minGradientImprovement: passIndex === 0 ? known48FlatFillMinGradientImprovement : known48FlatFillSecondPassMinGradientImprovement
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        stage: "known-48-flat-background-fill",
        strategy: "known-48-flat-fill",
        source: () => `${readPipelineRepairState(readState).source}+flat-fill`,
        deriveSuppressionGainFromOriginalSpatial: true
      } : null,
      known48LumaEdge: useKnown48EdgeCleanup ? {
        stage: "known-48-luma-edge-correction",
        strategy: "luma-edge",
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineKnown48LumaEdgeResidual2 === "function" ? refineKnown48LumaEdgeResidual2({
            sourceImageData: state.finalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            baselineSpatialScore: state.finalProcessedSpatialScore,
            baselineGradientScore: state.finalProcessedGradientScore
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+luma-edge`,
        deriveSuppressionGainFromOriginalSpatial: true
      } : null,
      newMargin96FlatFill: {
        stage: "new-margin-96-flat-background-fill",
        strategy: "new-margin-96-flat-fill",
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineNewMargin96FlatBackgroundResidual2 === "function" ? refineNewMargin96FlatBackgroundResidual2({
            sourceImageData: state.finalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            config: state.config,
            alphaGain: state.alphaGain,
            baselineSpatialScore: state.finalProcessedSpatialScore,
            baselineGradientScore: state.finalProcessedGradientScore
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+flat-fill`,
        deriveSuppressionGainFromOriginalSpatial: true
      }
    };
  }
  function createPostLocatedRepairStageSequenceSpecs({
    nowMs: nowMs2 = Date.now,
    timingAnchors = {},
    readState,
    originalImageData,
    originalSpatialScore,
    originalGradientScore,
    acceptCurrentRepairTrialResult,
    refiners = {}
  } = {}) {
    const {
      refineCanonical96PositiveHaloResidual: refineCanonical96PositiveHaloResidual2,
      refineSmoothLocatedResidualWithEstimatedPrior: refineSmoothLocatedResidualWithEstimatedPrior2
    } = refiners;
    return [
      {
        stage: "canonical-96-positive-halo-rescue",
        strategy: "canonical-96-positive-halo-repair",
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineCanonical96PositiveHaloResidual2 === "function" ? refineCanonical96PositiveHaloResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+canonical-96-positive-halo-rescue`,
        suppressionGain: (result) => result.suppressionGain
      },
      {
        stage: "smooth-located-estimated-prior",
        strategy: "smooth-located-prior",
        beforeStage: markTimingAnchor2({
          timingAnchors,
          timingKey: "smoothPriorStartedAt",
          nowMs: nowMs2
        }),
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineSmoothLocatedResidualWithEstimatedPrior2 === "function" ? refineSmoothLocatedResidualWithEstimatedPrior2({
            originalImageData,
            currentImageData: state.finalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            source: state.source,
            alphaGain: state.alphaGain,
            baselineSpatialScore: state.finalProcessedSpatialScore,
            baselineGradientScore: state.finalProcessedGradientScore
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+smooth-prior`,
        deriveSuppressionGainFromOriginalSpatial: true
      }
    ];
  }
  function createTailRepairStageSequenceSpecs({
    nowMs: nowMs2 = Date.now,
    timingAnchors = {},
    readState,
    originalImageData,
    originalSpatialScore,
    originalGradientScore,
    alpha96,
    getAlphaMap,
    acceptCurrentRepairTrialResult,
    refiners = {}
  } = {}) {
    const {
      refineKnown48SmallMarginPriorRepairResidual: refineKnown48SmallMarginPriorRepairResidual2,
      refineSmallLocatedPriorRepairResidual: refineSmallLocatedPriorRepairResidual2,
      refineKnown48BoundaryRepairResidual: refineKnown48BoundaryRepairResidual2,
      refineDarkHaloResidual: refineDarkHaloResidual2,
      refineQuantizedNegativeBodyResidual: refineQuantizedNegativeBodyResidual2,
      refineKnown48MidCoreBiasResidual: refineKnown48MidCoreBiasResidual2
    } = refiners;
    return [
      {
        stage: "known-48-small-margin-prior-repair",
        strategy: "small-margin-prior",
        beforeStage: markTimingAnchor2({
          timingAnchors,
          timingKey: "smallMarginPriorRepairStartedAt",
          nowMs: nowMs2
        }),
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineKnown48SmallMarginPriorRepairResidual2 === "function" ? refineKnown48SmallMarginPriorRepairResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore,
            source: state.source
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+small-margin-prior`,
        suppressionGain: (result) => result.suppressionGain
      },
      {
        stage: "small-located-prior-repair",
        strategy: "small-located-prior",
        beforeStage: markTimingAnchor2({
          timingAnchors,
          timingKey: "smallLocatedPriorRepairStartedAt",
          nowMs: nowMs2
        }),
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineSmallLocatedPriorRepairResidual2 === "function" ? refineSmallLocatedPriorRepairResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore,
            source: state.source
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+small-located-prior`,
        suppressionGain: (result) => result.suppressionGain
      },
      {
        stage: "known-48-boundary-repair-rescue",
        strategy: "boundary-repair",
        beforeStage: markTimingAnchor2({
          timingAnchors,
          timingKey: "boundaryRepairRescueStartedAt",
          nowMs: nowMs2
        }),
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineKnown48BoundaryRepairResidual2 === "function" ? refineKnown48BoundaryRepairResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            originalSpatialScore,
            originalGradientScore
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+boundary-repair-rescue`,
        suppressionGain: (result) => result.suppressionGain
      },
      {
        stage: "dark-halo-low-logo-rescue",
        strategy: "dark-halo-repair",
        beforeStage: markTimingAnchor2({
          timingAnchors,
          timingKey: "darkHaloRescueStartedAt",
          nowMs: nowMs2
        }),
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineDarkHaloResidual2 === "function" ? refineDarkHaloResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain,
            alpha96,
            getAlphaMap
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+dark-halo-rescue`,
        suppressionGain: (result) => result.suppressionGain
      },
      {
        stage: "quantized-body-correction",
        strategy: "quantized-body-correction",
        beforeStage: markTimingAnchor2({
          timingAnchors,
          timingKey: "quantizedBodyCorrectionStartedAt",
          nowMs: nowMs2
        }),
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineQuantizedNegativeBodyResidual2 === "function" ? refineQuantizedNegativeBodyResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            currentAlphaMap: state.alphaMap,
            currentPosition: state.position,
            currentConfig: state.config,
            currentSpatialScore: state.finalProcessedSpatialScore,
            currentGradientScore: state.finalProcessedGradientScore,
            currentAlphaGain: state.alphaGain
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+quantized-body-correction`,
        suppressionGain: (result) => result.suppressionGain
      },
      {
        stage: "known-48-mid-core-bias-correction",
        strategy: "mid-core-bias-correction",
        beforeStage: markTimingAnchor2({
          timingAnchors,
          timingKey: "midCoreBiasStartedAt",
          nowMs: nowMs2
        }),
        createStage: () => {
          const state = readPipelineRepairState(readState);
          return typeof refineKnown48MidCoreBiasResidual2 === "function" ? refineKnown48MidCoreBiasResidual2({
            originalImageData,
            currentImageData: state.finalImageData,
            alphaMap: state.alphaMap,
            position: state.position,
            source: state.source,
            alphaGain: state.alphaGain,
            baselineSpatialScore: state.finalProcessedSpatialScore,
            baselineGradientScore: state.finalProcessedGradientScore
          }) : null;
        },
        acceptCurrentRepairTrialResult,
        source: () => `${readPipelineRepairState(readState).source}+mid-core-bias`,
        deriveSuppressionGainFromOriginalSpatial: true
      }
    ];
  }

  // src/core/pipelineAcceptedExecutor.js
  function runAcceptedAlphaRepairPipeline({
    nowMs: nowMs2 = Date.now,
    totalStartedAt = null,
    runtimeBootstrap,
    pipelineTraceRecorder,
    originalImageData,
    alpha96,
    getAlphaMap,
    alpha96Variants = null,
    locatedAggressiveRemoval,
    debugTimings = null,
    debugTimingsEnabled = false,
    visualPostProcessingEnabled = false,
    templateWarp = null,
    passState,
    subpixelShift = null,
    metrics = {},
    gates = {},
    config = {},
    refiners = {}
  } = {}) {
    const {
      readPipelineState,
      applyPipelineState,
      cleanupFlags
    } = runtimeBootstrap;
    const {
      usePreviewAnchorFastCleanup,
      useKnown48EdgeCleanup,
      useV2SmallEdgeCleanup
    } = cleanupFlags;
    const {
      recordAlphaTrialEvent,
      acceptCurrentAlphaTrialResult,
      acceptCurrentAlphaStageResult,
      acceptCurrentRepairTrialResult,
      acceptRecalibrationStageResult,
      acceptLocatedAggressiveResult,
      acceptPreviewBackgroundCleanupResult,
      assignTailDebugTimings
    } = createAlphaRepairPipelineRuntime({
      traceRecorder: pipelineTraceRecorder,
      readState: readPipelineState,
      applyState: applyPipelineState,
      debugTimings
    });
    runRecalibrationStage(createRecalibrationStageSpec({
      nowMs: nowMs2,
      readState: readPipelineState,
      shouldRecalibrateAlphaStrength: gates.shouldRecalibrateAlphaStrength,
      calculateNearBlackRatio: metrics.calculateNearBlackRatio,
      computeRegionGradientCorrelation: metrics.computeRegionGradientCorrelation,
      acceptRecalibrationStageResult,
      debugTimings,
      debugTimingsEnabled,
      refiners: {
        recalibrateAlphaStrength: refiners.recalibrateAlphaStrength
      }
    }));
    runCurrentAlphaTrialSpecPhase({
      createSpecs: () => {
        const current = readPipelineState();
        return createFineAlphaTrialSequenceSpecs({
          nowMs: nowMs2,
          readState: readPipelineState,
          originalImageData,
          originalSpatialScore: current.originalSpatialScore,
          originalGradientScore: current.originalGradientScore,
          calculateNearBlackRatio: metrics.calculateNearBlackRatio,
          acceptCurrentAlphaTrialResult,
          debugTimings,
          debugTimingsEnabled,
          refiners: {
            recalibrateOverSubtractedAlpha: refiners.recalibrateOverSubtractedAlpha,
            fineTuneDarkCatalogAlpha: refiners.fineTuneDarkCatalogAlpha,
            fineTuneWeakPositiveResidualAlpha: refiners.fineTuneWeakPositiveResidualAlpha
          }
        });
      }
    });
    runPreviewBackgroundCleanupStage(createPreviewBackgroundCleanupStageSpec({
      nowMs: nowMs2,
      readState: readPipelineState,
      visualPostProcessingEnabled,
      maxNearBlackRatioIncrease: config.maxNearBlackRatioIncrease,
      measureOuterBorderLuminanceStd: metrics.measureOuterBorderLuminanceStd,
      shouldApplyPreviewSmoothBackgroundCleanup: gates.shouldApplyPreviewSmoothBackgroundCleanup,
      applyPreviewSmoothBackgroundCleanup: refiners.applyPreviewSmoothBackgroundCleanup,
      createRegionCorrelationMetrics: metrics.createRegionCorrelationMetrics,
      calculateNearBlackRatio: metrics.calculateNearBlackRatio,
      acceptPreviewBackgroundCleanupResult,
      debugTimings,
      debugTimingsEnabled
    }));
    const subpixelStartedAt = nowMs2();
    const subpixelAlphaStageResults = runCurrentAlphaStageSpecPhase({
      createSpecs: () => createSubpixelOutlineAlphaStageSpecs({
        readState: readPipelineState,
        calculateNearBlackRatio: metrics.calculateNearBlackRatio,
        templateWarp,
        visualPostProcessingEnabled,
        usePreviewAnchorFastCleanup,
        outlineConfig: config.outlineConfig,
        acceptCurrentAlphaStageResult,
        refiners: {
          refineSubpixelOutline: refiners.refineSubpixelOutline
        }
      })
    });
    const subpixelRefined = subpixelAlphaStageResults[0];
    if (subpixelRefined) {
      subpixelShift = subpixelRefined.shift;
    }
    if (debugTimingsEnabled && debugTimings) {
      debugTimings.subpixelRefinementMs = nowMs2() - subpixelStartedAt;
    }
    const shouldRunEdgeCleanup = visualPostProcessingEnabled || useKnown48EdgeCleanup || useV2SmallEdgeCleanup || usePreviewAnchorFastCleanup;
    const {
      previewEdgeCleanupElapsedMs
    } = runRepairCleanupSpecPhase({
      createSpecs: () => createRepairCleanupPhaseSpecs({
        nowMs: nowMs2,
        readState: readPipelineState,
        shouldRunEdgeCleanup,
        useKnown48EdgeCleanup,
        useV2SmallEdgeCleanup,
        usePreviewAnchorFastCleanup,
        cleanupConfig: config.repairCleanupConfig,
        acceptCurrentRepairTrialResult,
        refiners: {
          refinePreviewResidualEdge: refiners.refinePreviewResidualEdge,
          refineKnown48FlatBackgroundResidual: refiners.refineKnown48FlatBackgroundResidual,
          refineKnown48LumaEdgeResidual: refiners.refineKnown48LumaEdgeResidual,
          refineNewMargin96FlatBackgroundResidual: refiners.refineNewMargin96FlatBackgroundResidual
        }
      })
    });
    const smallAnchorTimingAnchors = {};
    const smallAnchorAlphaStageResults = runCurrentAlphaStageSpecPhase({
      createSpecs: () => createSmallAnchorAlphaStageSequenceSpecs({
        nowMs: nowMs2,
        timingAnchors: smallAnchorTimingAnchors,
        readState: readPipelineState,
        originalImageData,
        originalGradientScore: readPipelineState().originalGradientScore,
        alpha96,
        getAlphaMap,
        visualPostProcessingEnabled,
        assessWatermarkResidualVisibility: metrics.assessWatermarkResidualVisibility,
        acceptCurrentAlphaStageResult,
        refiners: {
          refineSmallPreviewAnchorCandidate: refiners.refineSmallPreviewAnchorCandidate,
          refineSmallFixedLocalAnchorGeometry: refiners.refineSmallFixedLocalAnchorGeometry
        }
      })
    });
    const smallFixedLocalRelocated = smallAnchorAlphaStageResults[1];
    const locatedAggressiveStartedAt = nowMs2();
    const locatedAggressiveRun = runLocatedAggressiveStage(createLocatedAggressiveStageSpec({
      readState: readPipelineState,
      originalImageData,
      originalSpatialScore: readPipelineState().originalSpatialScore,
      originalGradientScore: readPipelineState().originalGradientScore,
      smallFixedLocalRelocated,
      locatedAggressiveRemovalEnabled: locatedAggressiveRemoval,
      assessWatermarkResidualVisibility: metrics.assessWatermarkResidualVisibility,
      shouldSkipLocatedAggressiveForCleanCanonical96: gates.shouldSkipLocatedAggressiveForCleanCanonical96,
      recordAlphaTrialEvent,
      acceptLocatedAggressiveResult,
      currentPassState: passState,
      refiners: {
        refineLocatedAggressiveRemoval: refiners.refineLocatedAggressiveRemoval
      }
    }));
    passState = locatedAggressiveRun.passState;
    const postLocatedRepairTimingAnchors = {};
    runCurrentRepairStageSpecPhase({
      createSpecs: () => {
        const current = readPipelineState();
        return createPostLocatedRepairStageSequenceSpecs({
          nowMs: nowMs2,
          timingAnchors: postLocatedRepairTimingAnchors,
          readState: readPipelineState,
          originalImageData,
          originalSpatialScore: current.originalSpatialScore,
          originalGradientScore: current.originalGradientScore,
          acceptCurrentRepairTrialResult,
          refiners: {
            refineCanonical96PositiveHaloResidual: refiners.refineCanonical96PositiveHaloResidual,
            refineSmoothLocatedResidualWithEstimatedPrior: refiners.refineSmoothLocatedResidualWithEstimatedPrior
          }
        });
      }
    });
    const alphaRescueTimingAnchors = {};
    runCurrentAlphaStageSpecPhase({
      createSpecs: () => {
        const current = readPipelineState();
        return createAlphaRescueStageSequenceSpecs({
          nowMs: nowMs2,
          timingAnchors: alphaRescueTimingAnchors,
          readState: readPipelineState,
          originalImageData,
          originalSpatialScore: current.originalSpatialScore,
          originalGradientScore: current.originalGradientScore,
          resolveVariantAlphaMap: () => alpha96Variants?.["20260520"] ?? (typeof getAlphaMap === "function" ? getAlphaMap("96-20260520") : null),
          acceptCurrentAlphaStageResult,
          refiners: {
            refineNewMargin96VariantResidual: refiners.refineNewMargin96VariantResidual,
            refineKnown48AntiTemplateResidual: refiners.refineKnown48AntiTemplateResidual,
            refineKnown48PowerProfileResidual: refiners.refineKnown48PowerProfileResidual,
            refineKnown48PositiveResidualRebalance: refiners.refineKnown48PositiveResidualRebalance
          }
        });
      }
    });
    const tailRepairTimingAnchors = {};
    runCurrentRepairStageSpecPhase({
      createSpecs: () => {
        const current = readPipelineState();
        return createTailRepairStageSequenceSpecs({
          nowMs: nowMs2,
          timingAnchors: tailRepairTimingAnchors,
          readState: readPipelineState,
          originalImageData,
          originalSpatialScore: current.originalSpatialScore,
          originalGradientScore: current.originalGradientScore,
          alpha96,
          getAlphaMap,
          acceptCurrentRepairTrialResult,
          refiners: {
            refineKnown48SmallMarginPriorRepairResidual: refiners.refineKnown48SmallMarginPriorRepairResidual,
            refineSmallLocatedPriorRepairResidual: refiners.refineSmallLocatedPriorRepairResidual,
            refineKnown48BoundaryRepairResidual: refiners.refineKnown48BoundaryRepairResidual,
            refineDarkHaloResidual: refiners.refineDarkHaloResidual,
            refineQuantizedNegativeBodyResidual: refiners.refineQuantizedNegativeBodyResidual,
            refineKnown48MidCoreBiasResidual: refiners.refineKnown48MidCoreBiasResidual
          }
        });
      }
    });
    if (debugTimingsEnabled && debugTimings) {
      assignTailDebugTimings({
        nowMs: nowMs2,
        totalStartedAt,
        previewEdgeCleanupElapsedMs,
        ...smallAnchorTimingAnchors,
        locatedAggressiveStartedAt,
        ...postLocatedRepairTimingAnchors,
        ...alphaRescueTimingAnchors,
        ...tailRepairTimingAnchors
      });
    }
    return {
      passState,
      subpixelShift,
      readPipelineState
    };
  }

  // src/core/pipelineAcceptedExecutorRequest.js
  function createAcceptedPipelineExecutorRequest({
    nowMs: nowMs2,
    options = {},
    totalStartedAt,
    runtimeBootstrap,
    pipelineTraceRecorder,
    originalImageData,
    alpha96,
    debugTimings,
    debugTimingsEnabled,
    visualPostProcessingEnabled,
    templateWarp,
    subpixelShift,
    acceptedPipelineDependencies
  } = {}) {
    const {
      metrics,
      gates,
      config: executorConfig,
      refiners
    } = acceptedPipelineDependencies;
    return {
      nowMs: nowMs2,
      totalStartedAt,
      runtimeBootstrap,
      pipelineTraceRecorder,
      originalImageData,
      alpha96,
      getAlphaMap: options.getAlphaMap,
      alpha96Variants: options.alpha96Variants ?? null,
      locatedAggressiveRemoval: options.locatedAggressiveRemoval,
      debugTimings,
      debugTimingsEnabled,
      visualPostProcessingEnabled,
      templateWarp,
      passState: runtimeBootstrap.passState,
      subpixelShift,
      metrics,
      gates,
      config: executorConfig,
      refiners
    };
  }

  // src/core/pipelineAcceptedFinalizationRequest.js
  function createAcceptedPipelineFinalizationRequest({
    acceptedPipelineRun,
    pipelineTraceRecorder = {},
    resultContext = {},
    originalImageData = null,
    initialSelection = null,
    resolvedConfig = null
  } = {}) {
    return {
      pipelineState: acceptedPipelineRun.readPipelineState(),
      passState: acceptedPipelineRun.passState,
      traceState: {
        alphaAdjustmentStages: pipelineTraceRecorder.alphaAdjustmentStages,
        alphaTrialEvents: pipelineTraceRecorder.alphaTrialEvents
      },
      resultContext,
      originalImageData,
      initialSelection,
      resolvedConfig
    };
  }

  // src/core/selectionDebug.js
  function normalizeConfig3(config) {
    if (!config || typeof config !== "object") return null;
    const { logoSize, marginRight, marginBottom } = config;
    if (![logoSize, marginRight, marginBottom].every(Number.isFinite)) {
      return null;
    }
    return { logoSize, marginRight, marginBottom };
  }
  function normalizePosition3(position) {
    if (!position || typeof position !== "object") return null;
    const { x, y, width, height } = position;
    if (![x, y, width, height].every(Number.isFinite)) {
      return null;
    }
    return { x, y, width, height };
  }
  function normalizeNumber(value) {
    return Number.isFinite(value) ? value : null;
  }
  function normalizeResidual(residual) {
    if (!residual || typeof residual !== "object") return null;
    return {
      cleared: residual.cleared === true,
      spatialResidual: normalizeNumber(residual.spatialResidual),
      gradientResidual: normalizeNumber(residual.gradientResidual),
      suppressionGain: normalizeNumber(residual.suppressionGain),
      artifactCost: normalizeNumber(residual.artifactCost),
      score: normalizeNumber(residual.score)
    };
  }
  function normalizeDamage(damage) {
    if (!damage || typeof damage !== "object") return null;
    return {
      safe: damage.safe === true,
      penalty: normalizeNumber(damage.penalty),
      reason: typeof damage.reason === "string" ? damage.reason : null,
      nearBlackIncrease: normalizeNumber(damage.nearBlackIncrease),
      texturePenalty: normalizeNumber(damage.texturePenalty),
      newlyClippedRatio: normalizeNumber(damage.newlyClippedRatio),
      halo: damage.halo ?? null
    };
  }
  function normalizeOriginalEvidence(originalEvidence) {
    if (!originalEvidence || typeof originalEvidence !== "object") return null;
    return {
      tier: typeof originalEvidence.tier === "string" ? originalEvidence.tier : "none",
      spatial: normalizeNumber(originalEvidence.spatial),
      gradient: normalizeNumber(originalEvidence.gradient),
      score: normalizeNumber(originalEvidence.score)
    };
  }
  function createSelectionDebugSummary({
    selectedTrial,
    selectionSource = null,
    initialConfig = null,
    initialPosition = null
  } = {}) {
    if (!selectedTrial) return null;
    const candidateSource = typeof selectionSource === "string" && selectionSource ? selectionSource : typeof selectedTrial.source === "string" ? selectedTrial.source : null;
    return {
      candidateSource,
      initialConfig: normalizeConfig3(initialConfig),
      initialPosition: normalizePosition3(initialPosition),
      finalConfig: normalizeConfig3(selectedTrial.config),
      finalPosition: normalizePosition3(selectedTrial.position),
      sourcePriority: normalizeNumber(selectedTrial.sourcePriority),
      alphaPriorityIndex: normalizeNumber(selectedTrial.alphaPriorityIndex),
      rankingKey: Array.isArray(selectedTrial.rankingKey) ? [...selectedTrial.rankingKey] : null,
      earlyAccept: selectedTrial.earlyAccept === true,
      originalEvidence: normalizeOriginalEvidence(selectedTrial.originalEvidence),
      residual: normalizeResidual(selectedTrial.residual),
      damage: normalizeDamage(selectedTrial.damage),
      texturePenalty: Number.isFinite(selectedTrial.texturePenalty) ? selectedTrial.texturePenalty : null,
      tooDark: selectedTrial.tooDark === true,
      tooFlat: selectedTrial.tooFlat === true,
      hardReject: selectedTrial.hardReject === true,
      usedCatalogVariant: selectedTrial.provenance?.catalogVariant === true,
      usedSizeJitter: selectedTrial.provenance?.sizeJitter === true,
      usedLocalShift: selectedTrial.provenance?.localShift === true,
      usedAdaptive: selectedTrial.provenance?.adaptive === true,
      usedPreviewAnchor: selectedTrial.provenance?.previewAnchor === true
    };
  }

  // src/core/pipelineFinalization.js
  function createAcceptedPipelineFinalResult({
    pipelineState = {},
    passState = {},
    traceState = {},
    resultContext = {},
    originalImageData = null,
    initialSelection = null,
    resolvedConfig = null
  } = {}) {
    const residualVisibility = assessWatermarkResidualVisibility({
      imageData: pipelineState.finalImageData,
      position: pipelineState.position,
      alphaMap: pipelineState.alphaMap
    });
    const selectionSource = resultContext.selectionSource ?? initialSelection?.source ?? null;
    const initialPosition = originalImageData && resolvedConfig ? calculateWatermarkPosition(
      originalImageData.width,
      originalImageData.height,
      resolvedConfig
    ) : null;
    const selectionDebug = createSelectionDebugSummary({
      selectedTrial: resultContext.selectedTrial,
      selectionSource,
      initialConfig: resolvedConfig,
      initialPosition
    });
    if (shouldFailClosedForVisibleResidualUnsafeDamage({
      selectedTrial: resultContext.selectedTrial,
      residualVisibility
    })) {
      return createUnsafeVisibleResidualPipelineResultFromState({
        originalImageData,
        pipelineState,
        passState,
        traceState,
        resultContext: {
          ...resultContext,
          selectionSource
        },
        residualVisibility,
        selectionDebug
      });
    }
    return createAcceptedPipelineResultFromState({
      pipelineState,
      passState,
      traceState,
      resultContext: {
        ...resultContext,
        selectionSource
      },
      residualVisibility,
      selectionDebug
    });
  }

  // src/core/imageWatermarkPipeline.js
  function runImageWatermarkPipeline({
    imageData,
    options = {},
    nowMs: nowMs2,
    cloneImageData: cloneImageData4,
    alphaGainCandidates,
    alphaPriorityGains,
    createAcceptedPipelineDependencies: createAcceptedPipelineDependencies2,
    cleanupConfig,
    visualPostProcessingEnabled = false,
    selectCandidate,
    runAcceptedPipeline = runAcceptedAlphaRepairPipeline,
    createRejectedResult = createRejectedPipelineResult,
    createAcceptedFinalResult = createAcceptedPipelineFinalResult
  } = {}) {
    const totalStartedAt = nowMs2();
    const debugTimingsEnabled = options.debugTimings === true;
    const debugTimings = debugTimingsEnabled ? {} : null;
    const {
      originalImageData,
      alpha48,
      alpha96,
      alphaGainCandidates: resolvedAlphaGainCandidates,
      alphaPriorityGains: resolvedAlphaPriorityGains,
      allowAdaptiveSearch,
      resolvedConfig,
      position
    } = createInitialPipelineContext({
      imageData,
      options,
      cloneImageData: cloneImageData4,
      alphaGainCandidates,
      alphaPriorityGains
    });
    const pipelineTraceRecorder = createPipelineTraceRecorder();
    const initialSelectionStartedAt = nowMs2();
    const initialSelection = selectInitialWatermarkCandidate({
      originalImageData,
      config: resolvedConfig,
      position,
      alpha48,
      alpha96,
      alpha96Variants: options.alpha96Variants ?? null,
      getAlphaMap: options.getAlphaMap,
      allowAdaptiveSearch,
      aggressiveLocatedFallback: options.aggressiveLocatedFallback,
      alphaGainCandidates: resolvedAlphaGainCandidates,
      alphaPriorityGains: resolvedAlphaPriorityGains,
      selectCandidate
    });
    if (debugTimingsEnabled) {
      debugTimings.initialSelectionMs = nowMs2() - initialSelectionStartedAt;
    }
    if (!initialSelection.selectedTrial) {
      if (debugTimingsEnabled) {
        debugTimings.totalMs = nowMs2() - totalStartedAt;
      }
      return createRejectedResult({
        imageData: originalImageData,
        debugTimings,
        reason: "no-watermark-detected",
        adaptiveConfidence: initialSelection.adaptiveConfidence,
        originalSpatialScore: initialSelection.standardSpatialScore,
        originalGradientScore: initialSelection.standardGradientScore,
        source: "skipped",
        decisionTier: initialSelection.decisionTier ?? "insufficient",
        selectionDebug: null
      });
    }
    const selectedTrial = initialSelection.selectedTrial;
    const acceptedPipelineState = createAcceptedPipelineState({ initialSelection });
    const runtimeBootstrap = createAcceptedPipelineRuntimeBootstrap({
      nowMs: nowMs2,
      acceptedPipelineState,
      selectedTrial,
      debugTimings,
      debugTimingsEnabled,
      cleanupConfig
    });
    const acceptedPipelineDependencies = createAcceptedPipelineDependencies2();
    const acceptedPipelineRun = runAcceptedPipeline(createAcceptedPipelineExecutorRequest({
      nowMs: nowMs2,
      options,
      totalStartedAt,
      runtimeBootstrap,
      pipelineTraceRecorder,
      originalImageData,
      alpha96,
      debugTimings,
      debugTimingsEnabled,
      visualPostProcessingEnabled,
      templateWarp: acceptedPipelineState.templateWarp,
      subpixelShift: acceptedPipelineState.subpixelShift,
      acceptedPipelineDependencies
    }));
    return createAcceptedFinalResult(createAcceptedPipelineFinalizationRequest({
      acceptedPipelineRun,
      pipelineTraceRecorder,
      resultContext: {
        debugTimings,
        selectedTrial,
        selectionSource: initialSelection.source,
        adaptiveConfidence: acceptedPipelineState.adaptiveConfidence,
        templateWarp: acceptedPipelineState.templateWarp,
        decisionTier: acceptedPipelineState.decisionTier,
        subpixelShift: acceptedPipelineRun.subpixelShift
      },
      originalImageData,
      initialSelection,
      resolvedConfig
    }));
  }

  // src/core/imageWatermarkPipelineRequest.js
  function createImageWatermarkPipelineCleanupConfig({
    previewEdgeCleanupMaxSize,
    known48EdgeCleanupMinSize,
    known48EdgeCleanupMaxSize,
    v2SmallEdgeCleanupSize,
    v2SmallEdgeCleanupSizeTolerance
  } = {}) {
    return {
      previewEdgeCleanupMaxSize,
      known48EdgeCleanupMinSize,
      known48EdgeCleanupMaxSize,
      v2SmallEdgeCleanupSize,
      v2SmallEdgeCleanupSizeTolerance
    };
  }
  function createImageWatermarkPipelineRequest({
    imageData,
    options = {},
    nowMs: nowMs2,
    cloneImageData: cloneImageData4,
    alphaGainCandidates,
    alphaPriorityGains,
    createAcceptedPipelineDependencies: createAcceptedPipelineDependencies2,
    cleanupConfig,
    visualPostProcessingEnabled = false
  } = {}) {
    return {
      imageData,
      options,
      nowMs: nowMs2,
      cloneImageData: cloneImageData4,
      alphaGainCandidates,
      alphaPriorityGains,
      createAcceptedPipelineDependencies: createAcceptedPipelineDependencies2,
      cleanupConfig,
      visualPostProcessingEnabled
    };
  }

  // src/core/watermarkProcessor.js
  var RESIDUAL_RECALIBRATION_THRESHOLD = 0.5;
  var MIN_SUPPRESSION_FOR_SKIP_RECALIBRATION = 0.18;
  var MIN_RECALIBRATION_SCORE_DELTA = 0.18;
  var MAX_NEAR_BLACK_RATIO_INCREASE3 = 0.05;
  var OUTLINE_REFINEMENT_THRESHOLD = 0.42;
  var OUTLINE_REFINEMENT_MIN_GAIN = 1.2;
  var SUBPIXEL_REFINE_SHIFTS = [-0.25, 0, 0.25];
  var SUBPIXEL_REFINE_SCALES = [0.99, 1, 1.01];
  var ALPHA_PARAMETER_GROUPS = Object.freeze([
    { name: "gemini-weak-alpha-202606", alphaGain: 0.6, standardPriority: true },
    { name: "gemini-standard-alpha", alphaGain: 1, standardPriority: true },
    { name: "gemini-balanced-strong-alpha-202606", alphaGain: 1.1 },
    { name: "gemini-strong-alpha-202606", alphaGain: 1.15 },
    { name: "gemini-strong-alpha-high-202606", alphaGain: 1.3 },
    { name: "weak-alpha-extra-conservative", alphaGain: 0.45 },
    { name: "weak-alpha-light", alphaGain: 0.7 },
    { name: "weak-alpha-mid", alphaGain: 0.85 },
    { name: "weak-alpha-conservative", alphaGain: 0.55 }
  ]);
  var ALPHA_GAIN_CANDIDATES = ALPHA_PARAMETER_GROUPS.map((group) => group.alphaGain);
  var LOCATED_AGGRESSIVE_ALPHA_GAINS = Object.freeze([0.85, 1, 1.15, 1.3, 1.45, 1.7, 2, 2.4]);
  var LOCATED_AGGRESSIVE_MIN_BALANCED_GAIN = 0.015;
  var LOCATED_AGGRESSIVE_PASSABLE_SPATIAL_THRESHOLD = 0.22;
  var LOCATED_AGGRESSIVE_MAX_PASSABLE_SPATIAL_DRIFT = 0.02;
  var ENABLE_VISUAL_POST_PROCESSING = false;
  var CATALOG_DARK_ALPHA_GAIN_CANDIDATES = Object.freeze([0.9, 0.85, 0.8, 0.95, 0.7, 0.6]);
  var STANDARD_ALPHA_PRIORITY_GAINS = ALPHA_PARAMETER_GROUPS.filter((group) => group.standardPriority === true).map((group) => group.alphaGain);
  var PREVIEW_EDGE_CLEANUP_MAX_SIZE = 32;
  var KNOWN_48_EDGE_CLEANUP_MIN_SIZE = 40;
  var KNOWN_48_EDGE_CLEANUP_MAX_SIZE = 56;
  var KNOWN_48_EDGE_CLEANUP_MIN_GRADIENT = 0.22;
  var KNOWN_48_EDGE_CLEANUP_MAX_ABS_SPATIAL = 0.55;
  var KNOWN_48_EDGE_CLEANUP_MIN_GRADIENT_IMPROVEMENT = 0.015;
  var KNOWN_48_EDGE_CLEANUP_MAX_SPATIAL_DRIFT = 0.06;
  var V2_SMALL_EDGE_CLEANUP_SIZE = 36;
  var V2_SMALL_EDGE_CLEANUP_SIZE_TOLERANCE = 2;
  var V2_SMALL_EDGE_CLEANUP_MIN_GRADIENT = 0.22;
  var V2_SMALL_EDGE_CLEANUP_MAX_ABS_SPATIAL = 0.08;
  var V2_SMALL_EDGE_CLEANUP_MIN_GRADIENT_IMPROVEMENT = 0.025;
  var V2_SMALL_EDGE_CLEANUP_MAX_SPATIAL_DRIFT = 0.035;
  var KNOWN_48_FLAT_FILL_MIN_GRADIENT = 0.28;
  var KNOWN_48_FLAT_FILL_MAX_BACKGROUND_STD = 6;
  var KNOWN_48_FLAT_FILL_MIN_GRADIENT_IMPROVEMENT = 0.045;
  var KNOWN_48_FLAT_FILL_SECOND_PASS_MIN_GRADIENT_IMPROVEMENT = 0.025;
  var KNOWN_48_FLAT_FILL_MAX_APPLIED_PASSES = 2;
  var KNOWN_48_FLAT_FILL_MAX_SPATIAL_DRIFT = 0.12;
  var KNOWN_48_FLAT_FILL_MAX_ACCEPTED_ABS_SPATIAL = 0.38;
  var KNOWN_48_FLAT_FILL_PAD = 10;
  var KNOWN_48_FLAT_FILL_OUTSIDE_ALPHA_MAX = 0.012;
  var KNOWN_48_FLAT_FILL_PRESETS = Object.freeze([
    { name: "edge", minAlpha: 0.012, maxAlpha: 0.5, strength: 0.9 },
    { name: "wide", minAlpha: 8e-3, maxAlpha: 0.99, strength: 0.92 },
    { name: "hard", minAlpha: 4e-3, maxAlpha: 0.99, strength: 1 }
  ]);
  var NEW_MARGIN_96_FLAT_FILL_MIN_GRADIENT = 0.12;
  var NEW_MARGIN_96_FLAT_FILL_MAX_BACKGROUND_STD = 7;
  var NEW_MARGIN_96_FLAT_FILL_MIN_GRADIENT_IMPROVEMENT = 0.025;
  var NEW_MARGIN_96_FLAT_FILL_MAX_SPATIAL_DRIFT = 0.08;
  var NEW_MARGIN_96_FLAT_FILL_MAX_ACCEPTED_ABS_SPATIAL = 0.22;
  var NEW_MARGIN_96_FLAT_FILL_PRESETS = Object.freeze([
    { name: "edge", minAlpha: 6e-3, maxAlpha: 0.45, strength: 0.75 }
  ]);
  var NEW_MARGIN_96_VARIANT_RESCUE_PROFILES = Object.freeze([
    { exponent: 1.06, alphaGain: 1.05 },
    { exponent: 0.82, alphaGain: 0.9 }
  ]);
  var NEW_MARGIN_96_VARIANT_RESCUE_MIN_ORIGINAL_SPATIAL = 0.7;
  var NEW_MARGIN_96_VARIANT_RESCUE_MIN_ORIGINAL_GRADIENT = 0.7;
  var NEW_MARGIN_96_VARIANT_RESCUE_MIN_CURRENT_SPATIAL = 0.28;
  var NEW_MARGIN_96_VARIANT_RESCUE_MAX_CURRENT_GRADIENT = 0.18;
  var NEW_MARGIN_96_VARIANT_RESCUE_MAX_SPATIAL = 0.12;
  var NEW_MARGIN_96_VARIANT_RESCUE_MAX_GRADIENT = 0.2;
  var NEW_MARGIN_96_VARIANT_RESCUE_MAX_VISUAL_ARTIFACT = 0.24;
  var NEW_MARGIN_96_VARIANT_RESCUE_MAX_CLIPPED = 0.012;
  var KNOWN_48_LUMA_EDGE_MIN_GRADIENT = 0.2;
  var KNOWN_48_LUMA_EDGE_MIN_GRADIENT_IMPROVEMENT = 0.02;
  var KNOWN_48_LUMA_EDGE_MAX_SPATIAL_DRIFT = 0.04;
  var KNOWN_48_LUMA_EDGE_MAX_ACCEPTED_ABS_SPATIAL = 0.38;
  var KNOWN_48_LUMA_EDGE_PRESETS = Object.freeze([
    { name: "soft", minAlpha: 0.012, maxAlpha: 0.7, referenceAlphaMax: 0.025, radius: 2, strength: 0.28, colorSigma: 34, maxDelta: 22 },
    { name: "mid", minAlpha: 0.012, maxAlpha: 0.7, referenceAlphaMax: 0.04, radius: 3, strength: 0.42, colorSigma: 34, maxDelta: 32 },
    { name: "wide", minAlpha: 0.012, maxAlpha: 0.7, referenceAlphaMax: 0.055, radius: 4, strength: 0.48, colorSigma: 34, maxDelta: 40 }
  ]);
  var KNOWN_48_MID_CORE_BIAS_STRENGTH = 0.25;
  var KNOWN_48_MID_CORE_BIAS_MIN_HALO = 8;
  var KNOWN_48_MID_CORE_BIAS_MIN_HALO_REDUCTION = 0.5;
  var KNOWN_48_MID_CORE_BIAS_MAX_GRADIENT_DRIFT = 0.01;
  var KNOWN_48_MID_CORE_BIAS_MAX_SPATIAL_DRIFT = 0.02;
  var KNOWN_48_MID_CORE_BIAS_MAX_ARTIFACT_DRIFT = 1e-3;
  var KNOWN_48_MID_CORE_BIAS_MAX_NEW_CLIP_DRIFT = 1e-3;
  var PREVIEW_EDGE_CLEANUP_SPATIAL_THRESHOLD = 0.08;
  var PREVIEW_EDGE_CLEANUP_GRADIENT_THRESHOLD = 0.1;
  var SMALL_PREVIEW_EDGE_CLEANUP_MAX_SIZE = 32;
  var SMALL_PREVIEW_EDGE_CLEANUP_GRADIENT_THRESHOLD = 0.05;
  var PREVIEW_EDGE_CLEANUP_MIN_GRADIENT_IMPROVEMENT = 0.03;
  var PREVIEW_EDGE_CLEANUP_MAX_SPATIAL_DRIFT = 0.04;
  var PREVIEW_EDGE_CLEANUP_MAX_APPLIED_PASSES = 3;
  var PREVIEW_EDGE_CLEANUP_FINE_GRADIENT_THRESHOLD = 0.16;
  var PREVIEW_EDGE_CLEANUP_FINE_MIN_GRADIENT_IMPROVEMENT = 5e-3;
  var PREVIEW_EDGE_CLEANUP_HALO_RELAXED_MIN_GRADIENT_IMPROVEMENT = 0.01;
  var PREVIEW_EDGE_CLEANUP_HALO_WEIGHT = 0.02;
  var PREVIEW_EDGE_CLEANUP_MIN_HALO_REDUCTION = 1.5;
  var PREVIEW_EDGE_CLEANUP_STRONG_HALO_THRESHOLD = 4;
  var PREVIEW_EDGE_CLEANUP_HALO_SPATIAL_THRESHOLD = 0.18;
  var PREVIEW_EDGE_CLEANUP_PRESETS = Object.freeze([
    { minAlpha: 0.02, maxAlpha: 0.45, radius: 2, strength: 0.7, outsideAlphaMax: 0.05 },
    { minAlpha: 0.05, maxAlpha: 0.55, radius: 3, strength: 0.7, outsideAlphaMax: 0.08 },
    { minAlpha: 0.1, maxAlpha: 0.7, radius: 3, strength: 0.8, outsideAlphaMax: 0.12 },
    { minAlpha: 0.01, maxAlpha: 0.35, radius: 4, strength: 1.4, outsideAlphaMax: 0.05 }
  ]);
  var SMALL_PREVIEW_EDGE_CLEANUP_PRESETS = Object.freeze([
    {
      minAlpha: 0.01,
      maxAlpha: 0.55,
      radius: 2,
      strength: 2.4,
      outsideAlphaMax: 0.05,
      minGradientImprovement: 0.04,
      maxSpatialDrift: 0.12,
      maxAcceptedSpatial: 0.12
    }
  ]);
  var PREVIEW_EDGE_CLEANUP_STRONG_GRADIENT_THRESHOLD = 0.45;
  var PREVIEW_EDGE_CLEANUP_AGGRESSIVE_PRESETS = Object.freeze([
    {
      minAlpha: 0.01,
      maxAlpha: 0.55,
      radius: 2,
      strength: 1.3,
      outsideAlphaMax: 0.05,
      minGradientImprovement: 0.12,
      maxSpatialDrift: 0.18,
      maxAcceptedSpatial: 0.18
    }
  ]);
  var SMALL_PREVIEW_FLAT_FILL_MIN_SAMPLE_LUM = 190;
  var SMALL_PREVIEW_FLAT_FILL_MIN_BACKGROUND_MEAN = 230;
  var SMALL_PREVIEW_FLAT_FILL_MAX_BACKGROUND_STD = 8;
  var SMALL_PREVIEW_FLAT_FILL_MAX_GRADIENT = 0.02;
  var SMALL_PREVIEW_FLAT_FILL_MAX_ABS_SPATIAL = 0.08;
  var SMALL_PREVIEW_FLAT_FILL_PRESET = Object.freeze({
    pad: 14,
    outsideAlphaMax: 0.012,
    minSampleLum: SMALL_PREVIEW_FLAT_FILL_MIN_SAMPLE_LUM,
    minAlpha: 4e-3,
    minTargetLum: 170,
    strength: 1,
    maxBackgroundStd: SMALL_PREVIEW_FLAT_FILL_MAX_BACKGROUND_STD
  });
  var LOCATED_AGGRESSIVE_EDGE_PRESETS = Object.freeze([
    { minAlpha: 4e-3, maxAlpha: 0.99, radius: 2, strength: 0.85, outsideAlphaMax: 0.08 },
    { minAlpha: 4e-3, maxAlpha: 0.99, radius: 3, strength: 1.15, outsideAlphaMax: 0.12 },
    { minAlpha: 4e-3, maxAlpha: 0.99, radius: 5, strength: 1.45, outsideAlphaMax: 0.18 },
    { minAlpha: 0.02, maxAlpha: 0.99, radius: 6, strength: 1.8, outsideAlphaMax: 0.25 }
  ]);
  var PREVIEW_BACKGROUND_CLEANUP_MAX_SIZE = 52;
  var PREVIEW_BACKGROUND_CLEANUP_MIN_RESIDUAL = 0.3;
  var PREVIEW_BACKGROUND_CLEANUP_MAX_BORDER_STD = 24;
  var PREVIEW_BACKGROUND_CLEANUP_PAD = 8;
  var PREVIEW_BACKGROUND_CLEANUP_PRIOR_RADIUS = 10;
  var SMOOTH_PRIOR_LOCATED_MIN_SIZE = 80;
  var SMOOTH_PRIOR_LOCATED_MAX_SIZE = 160;
  var SMOOTH_PRIOR_LOCATED_MIN_BORDER_MEAN = 120;
  var SMOOTH_PRIOR_LOCATED_MIN_SPATIAL = 0.25;
  var SMOOTH_PRIOR_LOCATED_MAX_GRADIENT = 0.22;
  var SMOOTH_PRIOR_LOCATED_MIN_SPATIAL_IMPROVEMENT = 0.16;
  var SMOOTH_PRIOR_LOCATED_MAX_GRADIENT_DRIFT = 0.05;
  var SMOOTH_PRIOR_LOCATED_MIN_ARTIFACT_IMPROVEMENT = 0.025;
  var SMOOTH_PRIOR_LOCATED_MAX_ACCEPTED_GRADIENT = 0.18;
  var SMOOTH_PRIOR_LOCATED_PRESETS = Object.freeze([
    { radius: 24, threshold: 0, blurRadius: 0, strength: 0.75, gamma: 0.45 },
    { radius: 36, threshold: 0, blurRadius: 0, strength: 0.75, gamma: 0.45 },
    { radius: 24, threshold: 0.01, blurRadius: 0, strength: 0.75, gamma: 0.45 },
    { radius: 36, threshold: 0.01, blurRadius: 0, strength: 0.75, gamma: 0.45 }
  ]);
  var OVER_SUBTRACTION_SPATIAL_THRESHOLD = -0.25;
  var OVER_SUBTRACTION_GRADIENT_THRESHOLD = 0.35;
  var OVER_SUBTRACTION_MIN_ABS_SPATIAL_IMPROVEMENT = 0.08;
  var OVER_SUBTRACTION_MIN_GRADIENT_IMPROVEMENT = 0.08;
  var OVER_SUBTRACTION_FINE_ALPHA_STEP = 0.02;
  var OVER_SUBTRACTION_FINE_ALPHA_WINDOW = 0.04;
  var WEAK_ALPHA_FINE_TUNE_MIN_ORIGINAL_SPATIAL = 0.45;
  var WEAK_ALPHA_FINE_TUNE_MIN_POSITIVE_RESIDUAL = 0.05;
  var WEAK_ALPHA_FINE_TUNE_MIN_ABS_SPATIAL_IMPROVEMENT = 0.04;
  var WEAK_ALPHA_FINE_TUNE_MAX_GRADIENT_INCREASE = 0.08;
  var STRONG_POSITIVE_FINE_TUNE_MIN_ORIGINAL_SPATIAL = 0.75;
  var STRONG_POSITIVE_FINE_TUNE_MIN_ORIGINAL_GRADIENT = 0.65;
  var STRONG_POSITIVE_FINE_TUNE_MIN_CURRENT_SPATIAL = 0.3;
  var STRONG_POSITIVE_FINE_TUNE_MID_GAINS = Object.freeze([0.7, 0.85]);
  var STRONG_POSITIVE_FINE_TUNE_EXTRA_GAINS = Object.freeze([0.95, 1]);
  var STRONG_POSITIVE_FINE_TUNE_MAX_ACCEPTED_SPATIAL = 0.12;
  var STRONG_POSITIVE_FINE_TUNE_MAX_ACCEPTED_GRADIENT = 0.25;
  var STRONG_POSITIVE_FINE_TUNE_MAX_POSITIVE_HALO_LUM = 4;
  var CANONICAL_96_MODERATE_SIGNAL_MIN_ORIGINAL_SPATIAL = 0.4;
  var CANONICAL_96_MODERATE_SIGNAL_MIN_ORIGINAL_GRADIENT = 0.1;
  var CANONICAL_96_MODERATE_SIGNAL_MAX_CURRENT_SPATIAL = 0.26;
  var CANONICAL_96_MODERATE_SIGNAL_MAX_CURRENT_GRADIENT = 0.04;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_ORIGINAL_SPATIAL = 0.4;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_ORIGINAL_GRADIENT = 0.3;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_ABS_CURRENT_SPATIAL = 0.12;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_CURRENT_GRADIENT = 0.08;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_HALO = 6;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_HALO_REDUCTION = 4;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_POSITIVE_HALO = 2.3;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_ALPHA_GAIN = 1;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_RADIUS = 56;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_MIN_ALPHA = 0.08;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_THRESHOLD = 3;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_STRENGTH = 1;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_GAMMA = 0.7;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_SPATIAL = 0.18;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_GRADIENT = 0.08;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_VISUAL_ARTIFACT = 0.07;
  var CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_NEWLY_CLIPPED = 0.01;
  var CATALOG_ALPHA_DARK_FINE_TUNE_MIN_ORIGINAL_SPATIAL = 0.6;
  var CATALOG_ALPHA_DARK_FINE_TUNE_MIN_ORIGINAL_GRADIENT = 0.45;
  var CATALOG_ALPHA_DARK_FINE_TUNE_MAX_NEGATIVE_RESIDUAL = -0.12;
  var CATALOG_ALPHA_DARK_FINE_TUNE_MAX_GRADIENT_INCREASE = 0.12;
  var SMALL_PREVIEW_REFINEMENT_MAX_REFINED_SIZE = 56;
  var SMALL_PREVIEW_REFINEMENT_MIN_ABS_SPATIAL_IMPROVEMENT = 0.03;
  var SMALL_PREVIEW_REFINEMENT_MIN_GRADIENT_IMPROVEMENT = 0.03;
  var SMALL_PREVIEW_REFINEMENT_MAX_SOURCE_SIZE = 32;
  var SMALL_PREVIEW_REFINEMENT_MAX_ORIGINAL_GRADIENT = 0.15;
  var SMALL_PREVIEW_REFINEMENT_MIN_CURRENT_SPATIAL = 0.04;
  var SMALL_PREVIEW_REFINEMENT_MAX_CURRENT_GRADIENT = 0.08;
  var SMALL_ANCHOR_RELOCATION_MIN_SIZE = 40;
  var SMALL_ANCHOR_RELOCATION_MAX_SIZE = 56;
  var SMALL_ANCHOR_RELOCATION_SIZE_DELTA = 5;
  var SMALL_ANCHOR_RELOCATION_MARGIN_DELTA = 10;
  var SMALL_ANCHOR_RELOCATION_MIN_CURRENT_GRADIENT = 0.24;
  var SMALL_ANCHOR_RELOCATION_MAX_ACCEPTED_SPATIAL = 0.14;
  var SMALL_ANCHOR_RELOCATION_MAX_ACCEPTED_GRADIENT = 0.24;
  var SMALL_ANCHOR_RELOCATION_MIN_ORIGINAL_SPATIAL = 0.32;
  var SMALL_ANCHOR_RELOCATION_MIN_SUPPRESSION_GAIN = 0.22;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_SPATIAL = 0.4;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_GRADIENT = 0.45;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_SPATIAL = 0.25;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_GRADIENT = 0.4;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_CURRENT_SPATIAL = -0.16;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_CURRENT_GRADIENT = 0.18;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_BALANCED_GAIN = 0.035;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_SPATIAL = 0.12;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_GRADIENT = 0.2;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_DARK_HALO = 4;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_VISUAL_ARTIFACT = 0.2;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_GAINS = Object.freeze([0.45, 0.55, 0.6, 0.7, 0.85]);
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_SHARPEN_AMOUNT = 0.25;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_SHARPEN_ALPHA_GAIN = 0.55;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MIN_ALPHA = 0.24;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_ALPHA = 0.78;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_SCALE = 0.9;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_ALPHA_GAIN = 0.65;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_SPATIAL = 0.14;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_CURRENT_SPATIAL = -0.2;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_CURRENT_GRADIENT = -0.05;
  var KNOWN_48_POWER_PROFILE_RESCUE_CANDIDATES = Object.freeze([
    { exponent: 1.08, alphaGain: 0.6, maxSpatial: 0.14 },
    { exponent: 0.88, alphaGain: 0.55, maxSpatial: 0.16 }
  ]);
  var KNOWN_48_POWER_PROFILE_RESCUE_MIN_ORIGINAL_SPATIAL = 0.9;
  var KNOWN_48_POWER_PROFILE_RESCUE_MIN_ORIGINAL_GRADIENT = 0.8;
  var KNOWN_48_POWER_PROFILE_RESCUE_MIN_CURRENT_SPATIAL = 0.3;
  var KNOWN_48_POWER_PROFILE_RESCUE_MAX_CURRENT_GRADIENT = 0.14;
  var KNOWN_48_RESIDUAL_REBALANCE_GAINS = Object.freeze([0.62, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 1.05]);
  var KNOWN_48_RESIDUAL_REBALANCE_POWER_PROFILES = Object.freeze([
    { exponent: 1.08, gains: [0.65] },
    { exponent: 1.2, gains: [0.7] },
    { exponent: 0.75, gains: [0.51] }
  ]);
  var KNOWN_48_RESIDUAL_REBALANCE_MIN_ORIGINAL_SPATIAL = 0.45;
  var KNOWN_48_RESIDUAL_REBALANCE_MIN_ORIGINAL_GRADIENT = 0.16;
  var KNOWN_48_RESIDUAL_REBALANCE_MIN_CURRENT_SPATIAL = 0.22;
  var KNOWN_48_RESIDUAL_REBALANCE_MAX_CURRENT_GRADIENT = 0.05;
  var KNOWN_48_RESIDUAL_REBALANCE_MAX_ACCEPTED_SPATIAL = 0.22;
  var KNOWN_48_RESIDUAL_REBALANCE_MAX_ACCEPTED_GRADIENT = 0.32;
  var KNOWN_48_RESIDUAL_REBALANCE_MAX_VISUAL_ARTIFACT = 0.34;
  var KNOWN_48_RESIDUAL_REBALANCE_MAX_DARK_HALO = 0.2;
  var KNOWN_48_RESIDUAL_REBALANCE_MAX_CLIPPED_RATIO = 0.01;
  var KNOWN_48_RESIDUAL_REBALANCE_MIN_POSITIVE_HALO_DROP = 0.5;
  var KNOWN_48_RESIDUAL_REBALANCE_MAX_CLEARED_POSITIVE_HALO = 1.5;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_ORIGINAL_SPATIAL = 0.75;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_ORIGINAL_GRADIENT = 0.55;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_CURRENT_SPATIAL = 0.14;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_CURRENT_SPATIAL = 0.24;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_CURRENT_GRADIENT = 0.04;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_CURRENT_GRADIENT = 0.14;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_NEAR_BLACK_RATIO = 0.35;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_BALANCED_GAIN = 0.03;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_ARTIFACT_DELTA = 0.02;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_ARTIFACT = 0.16;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_SPATIAL = 0.13;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_GRADIENT = 0.13;
  var KNOWN_48_BOUNDARY_REPAIR_RESCUE_PRESET = Object.freeze({
    radius: 18,
    minAlpha: 0.04,
    maxAlpha: 0.75,
    strength: 0.68,
    gamma: 0.62
  });
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_PRESETS = Object.freeze([
    { radius: 72, minAlpha: 4e-3, maxAlpha: 0.7, strength: 1.3, gamma: 0.45 },
    { radius: 72, minAlpha: 0.02, maxAlpha: 0.7, strength: 1, gamma: 0.45 },
    { radius: 56, minAlpha: 4e-3, maxAlpha: 0.7, strength: 1.3, gamma: 0.45 }
  ]);
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_ORIGINAL_SPATIAL = 0.9;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_ORIGINAL_GRADIENT = 0.9;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_CURRENT_SPATIAL = 0.22;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_CURRENT_GRADIENT = 0.12;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_SPATIAL_IMPROVEMENT = 0.07;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_SPATIAL = 0.16;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_GRADIENT = 0.24;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_ARTIFACT = 0.26;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_CLIPPED = 5e-3;
  var KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_DARK_HALO = 0.2;
  var SMALL_LOCATED_PRIOR_REPAIR_PRESETS = Object.freeze([
    { radius: 16, minAlpha: 0.02, maxAlpha: 0.99, strength: 1, gamma: 0.45 },
    { radius: 72, minAlpha: 4e-3, maxAlpha: 0.7, strength: 1.3, gamma: 0.45 },
    { radius: 72, minAlpha: 0.02, maxAlpha: 0.7, strength: 1, gamma: 0.45 },
    { radius: 8, minAlpha: 0.02, maxAlpha: 0.99, strength: 1, gamma: 0.45 }
  ]);
  var SMALL_LOCATED_PRIOR_REPAIR_MIN_SIZE = 36;
  var SMALL_LOCATED_PRIOR_REPAIR_MAX_SIZE = 56;
  var SMALL_LOCATED_PRIOR_REPAIR_MIN_ORIGINAL_SPATIAL = 0.42;
  var SMALL_LOCATED_PRIOR_REPAIR_MIN_ORIGINAL_GRADIENT = 0.16;
  var SMALL_LOCATED_PRIOR_REPAIR_MIN_CURRENT_SPATIAL = 0.23;
  var SMALL_LOCATED_PRIOR_REPAIR_MAX_CURRENT_GRADIENT = 0.2;
  var SMALL_LOCATED_PRIOR_REPAIR_MIN_SPATIAL_IMPROVEMENT = 0.08;
  var SMALL_LOCATED_PRIOR_REPAIR_MAX_SPATIAL = 0.16;
  var SMALL_LOCATED_PRIOR_REPAIR_MAX_GRADIENT = 0.24;
  var SMALL_LOCATED_PRIOR_REPAIR_MAX_ARTIFACT = 0.28;
  var SMALL_LOCATED_PRIOR_REPAIR_MAX_CLIPPED = 5e-3;
  var SMALL_LOCATED_PRIOR_REPAIR_MAX_DARK_HALO = 3;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SIZE = 46;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MARGIN = 97;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MIN_ALPHA = 0.12;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_ALPHA = 0.42;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SCALE = 1.24;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_ALPHA_GAIN = 0.45;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MIN_ORIGINAL_SPATIAL = 0.12;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MIN_ORIGINAL_GRADIENT = 0.4;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_SPATIAL = 0.14;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_VISUAL_ARTIFACT = 0.22;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_CURRENT_SPATIAL = -0.18;
  var KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_CURRENT_GRADIENT = 0.05;
  var QUANTIZED_BODY_CORRECTION_SIZE = 48;
  var QUANTIZED_BODY_CORRECTION_MARGIN = 96;
  var QUANTIZED_BODY_CORRECTION_MAX_CURRENT_SPATIAL = -0.16;
  var QUANTIZED_BODY_CORRECTION_MAX_CURRENT_GRADIENT = 0.08;
  var QUANTIZED_BODY_CORRECTION_LOW_ALPHA_MAX = 0.04;
  var QUANTIZED_BODY_CORRECTION_LOW_ABS_MAX = 4;
  var QUANTIZED_BODY_CORRECTION_BODY_MIN_ALPHA = 0.12;
  var QUANTIZED_BODY_CORRECTION_BODY_MEAN_MAX = -0.5;
  var QUANTIZED_BODY_CORRECTION_BODY_NEGATIVE_RATIO_MIN = 0.2;
  var QUANTIZED_BODY_CORRECTION_RESIDUAL_THRESHOLD = -0.5;
  var QUANTIZED_BODY_CORRECTION_PRIOR_RADIUS = 6;
  var QUANTIZED_BODY_CORRECTION_MIN_BALANCED_GAIN = 0.03;
  var QUANTIZED_BODY_CORRECTION_MAX_ARTIFACT_INCREASE = 0.05;
  var DARK_HALO_RESCUE_MIN_DARK_HALO_LUM = 10;
  var DARK_HALO_RESCUE_MAX_CURRENT_SPATIAL = -0.16;
  var DARK_HALO_RESCUE_MAX_ABS_CURRENT_GRADIENT = 0.08;
  var DARK_HALO_RESCUE_MAX_DARK_HALO_LUM = 4;
  var DARK_HALO_RESCUE_MAX_VISUAL_ARTIFACT = 0.22;
  var DARK_HALO_RESCUE_MAX_NEWLY_CLIPPED_RATIO = 0.04;
  var DARK_HALO_RESCUE_MIN_BALANCED_GAIN = 0.04;
  var DARK_HALO_RESCUE_GAINS = Object.freeze([0.25, 0.35, 0.45]);
  var DARK_HALO_RESCUE_LOGO_VALUES = Object.freeze([224, 232, 240]);
  var DARK_HALO_RESCUE_CONFIGS = Object.freeze([
    { logoSize: 48, marginRight: 96, marginBottom: 98 },
    { logoSize: 48, marginRight: 96, marginBottom: 97 },
    { logoSize: 48, marginRight: 96, marginBottom: 96 },
    { logoSize: 46, marginRight: 97, marginBottom: 97 },
    { logoSize: 46, marginRight: 97, marginBottom: 96 },
    { logoSize: 46, marginRight: 96, marginBottom: 97 },
    { logoSize: 47, marginRight: 96, marginBottom: 96 },
    { logoSize: 47, marginRight: 97, marginBottom: 96 }
  ]);
  function nowMs() {
    if (typeof globalThis.performance?.now === "function") {
      return globalThis.performance.now();
    }
    return Date.now();
  }
  function cloneImageData3(imageData) {
    if (typeof ImageData !== "undefined" && imageData instanceof ImageData) {
      return new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height
      );
    }
    return {
      width: imageData.width,
      height: imageData.height,
      data: new Uint8ClampedArray(imageData.data)
    };
  }
  function shouldRecalibrateAlphaStrength({ originalScore, processedScore, suppressionGain }) {
    return originalScore >= 0.6 && processedScore >= RESIDUAL_RECALIBRATION_THRESHOLD && suppressionGain <= MIN_SUPPRESSION_FOR_SKIP_RECALIBRATION;
  }
  function refineSubpixelOutline({
    sourceImageData,
    alphaMap,
    position,
    alphaGain,
    originalNearBlackRatio,
    baselineSpatialScore,
    baselineGradientScore,
    baselineShift,
    minGain = OUTLINE_REFINEMENT_MIN_GAIN,
    shiftCandidates = SUBPIXEL_REFINE_SHIFTS,
    scaleCandidates = SUBPIXEL_REFINE_SCALES,
    minGradientImprovement = 0.04,
    maxSpatialDrift = 0.08
  }) {
    const size = position.width;
    if (!size || size <= 8) return null;
    if (alphaGain < minGain) return null;
    const maxAllowedNearBlackRatio = Math.min(1, originalNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE3);
    const gainCandidates = [alphaGain];
    const lower = Math.max(1, Number((alphaGain - 0.01).toFixed(2)));
    const upper = Number((alphaGain + 0.01).toFixed(2));
    if (lower !== alphaGain) gainCandidates.push(lower);
    if (upper !== alphaGain) gainCandidates.push(upper);
    const baseDx = baselineShift?.dx ?? 0;
    const baseDy = baselineShift?.dy ?? 0;
    const baseScale = baselineShift?.scale ?? 1;
    let best = null;
    for (const scaleDelta of scaleCandidates) {
      const scale = Number((baseScale * scaleDelta).toFixed(4));
      for (const dyDelta of shiftCandidates) {
        const dy = baseDy + dyDelta;
        for (const dxDelta of shiftCandidates) {
          const dx = baseDx + dxDelta;
          const warped = warpAlphaMap(alphaMap, size, { dx, dy, scale });
          for (const gain of gainCandidates) {
            const candidate = cloneImageData3(sourceImageData);
            removeWatermark(candidate, warped, position, { alphaGain: gain });
            const nearBlackRatio = calculateNearBlackRatio(candidate, position);
            if (nearBlackRatio > maxAllowedNearBlackRatio) continue;
            const spatialScore = computeRegionSpatialCorrelation({
              imageData: candidate,
              alphaMap: warped,
              region: { x: position.x, y: position.y, size }
            });
            const gradientScore = computeRegionGradientCorrelation({
              imageData: candidate,
              alphaMap: warped,
              region: { x: position.x, y: position.y, size }
            });
            const cost = Math.abs(spatialScore) * 0.6 + Math.max(0, gradientScore);
            if (!best || cost < best.cost) {
              best = {
                imageData: candidate,
                alphaMap: warped,
                alphaGain: gain,
                shift: { dx, dy, scale },
                spatialScore,
                gradientScore,
                nearBlackRatio,
                cost
              };
            }
          }
        }
      }
    }
    if (!best) return null;
    const improvedGradient = best.gradientScore <= baselineGradientScore - minGradientImprovement;
    const keptSpatial = Math.abs(best.spatialScore) <= Math.abs(baselineSpatialScore) + maxSpatialDrift;
    if (!improvedGradient || !keptSpatial) return null;
    return best;
  }
  function recalibrateAlphaStrength({
    sourceImageData,
    alphaMap,
    position,
    originalSpatialScore,
    processedSpatialScore,
    originalNearBlackRatio
  }) {
    let bestScore = processedSpatialScore;
    let bestGain = 1;
    let bestImageData = null;
    const maxAllowedNearBlackRatio = Math.min(1, originalNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE3);
    for (const alphaGain of ALPHA_GAIN_CANDIDATES) {
      const candidate = cloneImageData3(sourceImageData);
      removeWatermark(candidate, alphaMap, position, { alphaGain });
      const candidateNearBlackRatio = calculateNearBlackRatio(candidate, position);
      if (candidateNearBlackRatio > maxAllowedNearBlackRatio) {
        continue;
      }
      const score = computeRegionSpatialCorrelation({
        imageData: candidate,
        alphaMap,
        region: {
          x: position.x,
          y: position.y,
          size: position.width
        }
      });
      if (score < bestScore) {
        bestScore = score;
        bestGain = alphaGain;
        bestImageData = candidate;
      }
    }
    const scoreDelta = processedSpatialScore - bestScore;
    if (!bestImageData || scoreDelta < MIN_RECALIBRATION_SCORE_DELTA) {
      return null;
    }
    return {
      imageData: bestImageData,
      alphaGain: bestGain,
      processedSpatialScore: bestScore,
      suppressionGain: originalSpatialScore - bestScore
    };
  }
  function recalibrateOverSubtractedAlpha({
    originalImageData,
    alphaMap,
    position,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalNearBlackRatio
  }) {
    if (currentSpatialScore > OVER_SUBTRACTION_SPATIAL_THRESHOLD || currentGradientScore < OVER_SUBTRACTION_GRADIENT_THRESHOLD) {
      return null;
    }
    const maxAllowedNearBlackRatio = Math.min(1, originalNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE3);
    let best = null;
    const evaluateAlphaGain = (alphaGain) => {
      const candidate = cloneImageData3(originalImageData);
      removeWatermark(candidate, alphaMap, position, { alphaGain });
      const nearBlackRatio = calculateNearBlackRatio(candidate, position);
      if (nearBlackRatio > maxAllowedNearBlackRatio) return null;
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const artifacts = assessRemovalDiffArtifacts({
        originalImageData,
        candidateImageData: candidate,
        alphaMap,
        position,
        alphaGain
      });
      const absSpatialImprovement = Math.abs(currentSpatialScore) - Math.abs(spatialScore);
      const gradientImprovement = currentGradientScore - gradientScore;
      if (absSpatialImprovement < OVER_SUBTRACTION_MIN_ABS_SPATIAL_IMPROVEMENT || gradientImprovement < OVER_SUBTRACTION_MIN_GRADIENT_IMPROVEMENT) {
        return null;
      }
      const cost = artifacts?.visualArtifactCost ?? Math.abs(spatialScore) + Math.max(0, gradientScore) * 0.8 + nearBlackRatio * 2;
      return {
        imageData: candidate,
        alphaGain,
        spatialScore,
        gradientScore,
        nearBlackRatio,
        suppressionGain: originalSpatialScore - spatialScore,
        cost
      };
    };
    for (const alphaGain of ALPHA_GAIN_CANDIDATES) {
      if (alphaGain >= currentAlphaGain) continue;
      const candidate = evaluateAlphaGain(alphaGain);
      if (!candidate) continue;
      if (!best || candidate.cost < best.cost) {
        best = candidate;
      }
    }
    if (!best) return null;
    const fineGains = /* @__PURE__ */ new Set();
    const fineStepCount = Math.round(OVER_SUBTRACTION_FINE_ALPHA_WINDOW / OVER_SUBTRACTION_FINE_ALPHA_STEP);
    for (let step = -fineStepCount; step <= fineStepCount; step++) {
      const alphaGain = Number((best.alphaGain + step * OVER_SUBTRACTION_FINE_ALPHA_STEP).toFixed(2));
      if (alphaGain <= 0 || alphaGain >= currentAlphaGain) continue;
      fineGains.add(alphaGain);
    }
    for (const alphaGain of fineGains) {
      if (alphaGain === best.alphaGain) continue;
      const candidate = evaluateAlphaGain(alphaGain);
      if (!candidate) continue;
      if (candidate.cost < best.cost) {
        best = candidate;
      }
    }
    return best;
  }
  function fineTuneWeakPositiveResidualAlpha({
    originalImageData,
    alphaMap,
    position,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore,
    originalNearBlackRatio
  }) {
    if (currentAlphaGain >= 1 || originalSpatialScore < WEAK_ALPHA_FINE_TUNE_MIN_ORIGINAL_SPATIAL || currentSpatialScore < WEAK_ALPHA_FINE_TUNE_MIN_POSITIVE_RESIDUAL) {
      return null;
    }
    const maxAllowedNearBlackRatio = Math.min(1, originalNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE3);
    let best = null;
    const fineStepCount = Math.round(OVER_SUBTRACTION_FINE_ALPHA_WINDOW / OVER_SUBTRACTION_FINE_ALPHA_STEP);
    const alphaGainCandidates = /* @__PURE__ */ new Set();
    for (let step = 1; step <= fineStepCount; step++) {
      const alphaGain = Number((currentAlphaGain + step * OVER_SUBTRACTION_FINE_ALPHA_STEP).toFixed(2));
      if (alphaGain >= 1) continue;
      alphaGainCandidates.add(alphaGain);
    }
    const shouldTryStrongPositiveFineTune = currentSpatialScore >= STRONG_POSITIVE_FINE_TUNE_MIN_CURRENT_SPATIAL && originalSpatialScore >= STRONG_POSITIVE_FINE_TUNE_MIN_ORIGINAL_SPATIAL && originalGradientScore >= STRONG_POSITIVE_FINE_TUNE_MIN_ORIGINAL_GRADIENT;
    if (shouldTryStrongPositiveFineTune) {
      for (const alphaGain of [
        ...STRONG_POSITIVE_FINE_TUNE_MID_GAINS,
        ...STRONG_POSITIVE_FINE_TUNE_EXTRA_GAINS
      ]) {
        alphaGainCandidates.add(alphaGain);
      }
    }
    for (const alphaGain of alphaGainCandidates) {
      if (alphaGain <= currentAlphaGain || alphaGain > 1) continue;
      const candidate = cloneImageData3(originalImageData);
      removeWatermark(candidate, alphaMap, position, { alphaGain });
      const nearBlackRatio = calculateNearBlackRatio(candidate, position);
      if (nearBlackRatio > maxAllowedNearBlackRatio) continue;
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const artifacts = assessRemovalDiffArtifacts({
        originalImageData,
        candidateImageData: candidate,
        alphaMap,
        position,
        alphaGain
      });
      const absSpatialImprovement = Math.abs(currentSpatialScore) - Math.abs(spatialScore);
      const gradientIncrease = gradientScore - currentGradientScore;
      const strongPositiveClearsResidual = shouldTryStrongPositiveFineTune && Math.abs(spatialScore) <= STRONG_POSITIVE_FINE_TUNE_MAX_ACCEPTED_SPATIAL && gradientScore <= STRONG_POSITIVE_FINE_TUNE_MAX_ACCEPTED_GRADIENT && (artifacts?.halo?.positiveDeltaLum ?? Number.POSITIVE_INFINITY) <= STRONG_POSITIVE_FINE_TUNE_MAX_POSITIVE_HALO_LUM;
      if (!strongPositiveClearsResidual && (absSpatialImprovement < WEAK_ALPHA_FINE_TUNE_MIN_ABS_SPATIAL_IMPROVEMENT || gradientIncrease > WEAK_ALPHA_FINE_TUNE_MAX_GRADIENT_INCREASE)) {
        continue;
      }
      const cost = artifacts ? artifacts.visualArtifactCost + Math.max(0, gradientIncrease) * 0.25 : Math.abs(spatialScore) + Math.max(0, gradientIncrease) * 0.25 + nearBlackRatio * 2;
      const clearsResidual = strongPositiveClearsResidual;
      if (!best || clearsResidual && !best.clearsResidual || clearsResidual === best.clearsResidual && cost < best.cost) {
        best = {
          imageData: candidate,
          alphaGain,
          spatialScore,
          gradientScore,
          nearBlackRatio,
          suppressionGain: originalSpatialScore - spatialScore,
          cost,
          clearsResidual
        };
      }
    }
    return best;
  }
  function fineTuneDarkCatalogAlpha({
    originalImageData,
    alphaMap,
    position,
    source,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore,
    originalNearBlackRatio
  }) {
    if (typeof source !== "string" || !source.includes("catalog") || currentAlphaGain < 1 || originalSpatialScore < CATALOG_ALPHA_DARK_FINE_TUNE_MIN_ORIGINAL_SPATIAL || originalGradientScore < CATALOG_ALPHA_DARK_FINE_TUNE_MIN_ORIGINAL_GRADIENT || currentSpatialScore > CATALOG_ALPHA_DARK_FINE_TUNE_MAX_NEGATIVE_RESIDUAL) {
      return null;
    }
    const maxAllowedNearBlackRatio = Math.min(1, originalNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE3);
    let best = null;
    for (const alphaGain of CATALOG_DARK_ALPHA_GAIN_CANDIDATES) {
      if (alphaGain >= currentAlphaGain) continue;
      const candidate = cloneImageData3(originalImageData);
      removeWatermark(candidate, alphaMap, position, { alphaGain });
      const nearBlackRatio = calculateNearBlackRatio(candidate, position);
      if (nearBlackRatio > maxAllowedNearBlackRatio) continue;
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const artifacts = assessRemovalDiffArtifacts({
        originalImageData,
        candidateImageData: candidate,
        alphaMap,
        position,
        alphaGain
      });
      const absSpatialImprovement = Math.abs(currentSpatialScore) - Math.abs(spatialScore);
      const gradientIncrease = gradientScore - currentGradientScore;
      if (absSpatialImprovement <= 0 || gradientIncrease > CATALOG_ALPHA_DARK_FINE_TUNE_MAX_GRADIENT_INCREASE) {
        continue;
      }
      const cost = artifacts?.visualArtifactCost ?? Math.abs(spatialScore) * 0.25 + Math.max(0, gradientScore) + nearBlackRatio * 2;
      if (!best || cost < best.cost) {
        best = {
          imageData: candidate,
          alphaGain,
          spatialScore,
          gradientScore,
          nearBlackRatio,
          suppressionGain: originalSpatialScore - spatialScore,
          cost
        };
      }
    }
    return best;
  }
  function shouldRefineResidualEdge({
    source,
    position,
    baselineSpatialScore,
    baselineGradientScore,
    baselinePositiveHalo,
    mode = "preview"
  }) {
    if (mode === "known-48") {
      return position?.width >= KNOWN_48_EDGE_CLEANUP_MIN_SIZE && position?.width <= KNOWN_48_EDGE_CLEANUP_MAX_SIZE && Math.abs(baselineSpatialScore) <= KNOWN_48_EDGE_CLEANUP_MAX_ABS_SPATIAL && (baselineGradientScore >= KNOWN_48_EDGE_CLEANUP_MIN_GRADIENT || baselinePositiveHalo >= PREVIEW_EDGE_CLEANUP_STRONG_HALO_THRESHOLD);
    }
    if (mode === "v2-small") {
      return position?.width >= V2_SMALL_EDGE_CLEANUP_SIZE - V2_SMALL_EDGE_CLEANUP_SIZE_TOLERANCE && position?.width <= V2_SMALL_EDGE_CLEANUP_SIZE + V2_SMALL_EDGE_CLEANUP_SIZE_TOLERANCE && Math.abs(baselineSpatialScore) <= V2_SMALL_EDGE_CLEANUP_MAX_ABS_SPATIAL && baselineGradientScore >= V2_SMALL_EDGE_CLEANUP_MIN_GRADIENT;
    }
    const isSmallPreviewAnchor = position?.width >= 24 && position?.width <= SMALL_PREVIEW_EDGE_CLEANUP_MAX_SIZE;
    const gradientThreshold = isSmallPreviewAnchor ? SMALL_PREVIEW_EDGE_CLEANUP_GRADIENT_THRESHOLD : PREVIEW_EDGE_CLEANUP_GRADIENT_THRESHOLD;
    return typeof source === "string" && source.includes("preview-anchor") && position?.width >= 24 && position?.width <= PREVIEW_EDGE_CLEANUP_MAX_SIZE && (Math.abs(baselineSpatialScore) <= PREVIEW_EDGE_CLEANUP_SPATIAL_THRESHOLD || baselinePositiveHalo >= PREVIEW_EDGE_CLEANUP_STRONG_HALO_THRESHOLD && Math.abs(baselineSpatialScore) <= PREVIEW_EDGE_CLEANUP_HALO_SPATIAL_THRESHOLD) && baselineGradientScore >= gradientThreshold;
  }
  function blendPreviewResidualEdge({
    sourceImageData,
    alphaMap,
    position,
    minAlpha,
    maxAlpha,
    radius,
    strength,
    outsideAlphaMax
  }) {
    const candidate = cloneImageData3(sourceImageData);
    const { width: imageWidth, height: imageHeight, data } = sourceImageData;
    const regionSize = position.width;
    const maxAlphaSafe = Math.max(maxAlpha, 1e-6);
    const edgeMask = createAlphaGradientMask({
      alphaMap,
      width: regionSize,
      height: regionSize
    });
    for (let row = 0; row < regionSize; row++) {
      for (let col = 0; col < regionSize; col++) {
        const localIndex = row * regionSize + col;
        const alpha = Math.abs(alphaMap[localIndex]);
        if (alpha < minAlpha || alpha > maxAlpha) continue;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        let sumWeight = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const localY = row + dy;
            const localX = col + dx;
            const pixelX = position.x + localX;
            const pixelY = position.y + localY;
            if (pixelX < 0 || pixelY < 0 || pixelX >= imageWidth || pixelY >= imageHeight) {
              continue;
            }
            let neighborAlpha = 0;
            if (localY >= 0 && localX >= 0 && localY < regionSize && localX < regionSize) {
              neighborAlpha = Math.abs(alphaMap[localY * regionSize + localX]);
            }
            if (neighborAlpha > outsideAlphaMax) continue;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const weight = 1 / distance;
            const pixelIndex2 = (pixelY * imageWidth + pixelX) * 4;
            sumR += data[pixelIndex2] * weight;
            sumG += data[pixelIndex2 + 1] * weight;
            sumB += data[pixelIndex2 + 2] * weight;
            sumWeight += weight;
          }
        }
        if (sumWeight <= 0) continue;
        const edgeWeight = getAlphaGradientWeight(edgeMask, localIndex);
        const blend = Math.max(0, Math.min(1, strength * alpha / maxAlphaSafe * edgeWeight));
        const pixelIndex = ((position.y + row) * imageWidth + (position.x + col)) * 4;
        candidate.data[pixelIndex] = Math.round(data[pixelIndex] * (1 - blend) + sumR / sumWeight * blend);
        candidate.data[pixelIndex + 1] = Math.round(data[pixelIndex + 1] * (1 - blend) + sumG / sumWeight * blend);
        candidate.data[pixelIndex + 2] = Math.round(data[pixelIndex + 2] * (1 - blend) + sumB / sumWeight * blend);
      }
    }
    return candidate;
  }
  function solveLinear3x3(matrix, vector) {
    const augmented = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < 3; column++) {
      let pivot = column;
      for (let row = column + 1; row < 3; row++) {
        if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) {
          pivot = row;
        }
      }
      if (Math.abs(augmented[pivot][column]) < 1e-8) return null;
      if (pivot !== column) {
        [augmented[pivot], augmented[column]] = [augmented[column], augmented[pivot]];
      }
      const divisor = augmented[column][column];
      for (let next = column; next < 4; next++) {
        augmented[column][next] /= divisor;
      }
      for (let row = 0; row < 3; row++) {
        if (row === column) continue;
        const factor = augmented[row][column];
        for (let next = column; next < 4; next++) {
          augmented[row][next] -= factor * augmented[column][next];
        }
      }
    }
    return [augmented[0][3], augmented[1][3], augmented[2][3]];
  }
  function fitColorPlane(samples, channel) {
    const matrix = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0]
    ];
    const vector = [0, 0, 0];
    for (const sample of samples) {
      const terms = [1, sample.x, sample.y];
      const value = sample[channel];
      for (let row = 0; row < 3; row++) {
        vector[row] += terms[row] * value;
        for (let column = 0; column < 3; column++) {
          matrix[row][column] += terms[row] * terms[column];
        }
      }
    }
    return solveLinear3x3(matrix, vector);
  }
  function calculateBackgroundSampleStats(samples) {
    let sum = 0;
    let squareSum = 0;
    for (const sample of samples) {
      const luminance = 0.2126 * sample.r + 0.7152 * sample.g + 0.0722 * sample.b;
      sum += luminance;
      squareSum += luminance * luminance;
    }
    const count = samples.length;
    const mean = count > 0 ? sum / count : 0;
    return {
      count,
      mean,
      std: count > 0 ? Math.sqrt(Math.max(0, squareSum / count - mean * mean)) : Number.POSITIVE_INFINITY
    };
  }
  function sampleFlatBackgroundPixels(imageData, alphaMap, position, {
    pad = KNOWN_48_FLAT_FILL_PAD,
    outsideAlphaMax = KNOWN_48_FLAT_FILL_OUTSIDE_ALPHA_MAX,
    minSampleLum = 0
  } = {}) {
    const samples = [];
    const left = Math.max(0, position.x - pad);
    const top = Math.max(0, position.y - pad);
    const right = Math.min(imageData.width - 1, position.x + position.width + pad - 1);
    const bottom = Math.min(imageData.height - 1, position.y + position.height + pad - 1);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const inside = x >= position.x && x < position.x + position.width && y >= position.y && y < position.y + position.height;
        if (inside) {
          const row = y - position.y;
          const col = x - position.x;
          if (alphaMap[row * position.width + col] > outsideAlphaMax) {
            continue;
          }
        }
        const pixelIndex = (y * imageData.width + x) * 4;
        const luminance = 0.2126 * imageData.data[pixelIndex] + 0.7152 * imageData.data[pixelIndex + 1] + 0.0722 * imageData.data[pixelIndex + 2];
        if (luminance < minSampleLum) continue;
        samples.push({
          x: (x - position.x) / Math.max(1, position.width),
          y: (y - position.y) / Math.max(1, position.height),
          r: imageData.data[pixelIndex],
          g: imageData.data[pixelIndex + 1],
          b: imageData.data[pixelIndex + 2]
        });
      }
    }
    return samples;
  }
  function applyFlatBackgroundFill({
    sourceImageData,
    alphaMap,
    position,
    minAlpha,
    maxAlpha,
    strength,
    maxBackgroundStd = KNOWN_48_FLAT_FILL_MAX_BACKGROUND_STD,
    edgeWeightFloor = 0.35,
    pad = KNOWN_48_FLAT_FILL_PAD,
    outsideAlphaMax = KNOWN_48_FLAT_FILL_OUTSIDE_ALPHA_MAX,
    minSampleLum = 0
  }) {
    const samples = sampleFlatBackgroundPixels(sourceImageData, alphaMap, position, {
      pad,
      outsideAlphaMax,
      minSampleLum
    });
    const stats = calculateBackgroundSampleStats(samples);
    if (stats.count < 24 || stats.std > maxBackgroundStd) {
      return null;
    }
    const redPlane = fitColorPlane(samples, "r");
    const greenPlane = fitColorPlane(samples, "g");
    const bluePlane = fitColorPlane(samples, "b");
    if (!redPlane || !greenPlane || !bluePlane) return null;
    const candidate = cloneImageData3(sourceImageData);
    const edgeMask = createAlphaGradientMask({
      alphaMap,
      width: position.width,
      height: position.height
    });
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const alpha = alphaMap[localIndex];
        if (alpha < minAlpha || alpha > maxAlpha) continue;
        const x = col / Math.max(1, position.width);
        const y = row / Math.max(1, position.height);
        const target = [
          redPlane[0] + redPlane[1] * x + redPlane[2] * y,
          greenPlane[0] + greenPlane[1] * x + greenPlane[2] * y,
          bluePlane[0] + bluePlane[1] * x + bluePlane[2] * y
        ];
        const pixelIndex = ((position.y + row) * candidate.width + position.x + col) * 4;
        const edgeWeight = getAlphaGradientWeight(edgeMask, localIndex, edgeWeightFloor);
        const blend = Math.max(0, Math.min(1, strength * Math.min(1, alpha / 0.2) * edgeWeight));
        for (let channel = 0; channel < 3; channel++) {
          candidate.data[pixelIndex + channel] = clampChannel2(
            candidate.data[pixelIndex + channel] * (1 - blend) + target[channel] * blend
          );
        }
      }
    }
    return { imageData: candidate, stats };
  }
  function applySmallPreviewBrightBackgroundFill({
    sourceImageData,
    alphaMap,
    position,
    minAlpha,
    minTargetLum,
    strength,
    pad,
    outsideAlphaMax,
    minSampleLum,
    maxBackgroundStd
  }) {
    const samples = sampleFlatBackgroundPixels(sourceImageData, alphaMap, position, {
      pad,
      outsideAlphaMax,
      minSampleLum
    });
    const stats = calculateBackgroundSampleStats(samples);
    if (stats.count < 24 || stats.std > maxBackgroundStd) {
      return null;
    }
    const redPlane = fitColorPlane(samples, "r");
    const greenPlane = fitColorPlane(samples, "g");
    const bluePlane = fitColorPlane(samples, "b");
    if (!redPlane || !greenPlane || !bluePlane) return null;
    const candidate = cloneImageData3(sourceImageData);
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        if (alphaMap[localIndex] < minAlpha) continue;
        const pixelIndex = ((position.y + row) * candidate.width + position.x + col) * 4;
        const currentLum = 0.2126 * candidate.data[pixelIndex] + 0.7152 * candidate.data[pixelIndex + 1] + 0.0722 * candidate.data[pixelIndex + 2];
        if (currentLum < minTargetLum) continue;
        const x = col / Math.max(1, position.width);
        const y = row / Math.max(1, position.height);
        const target = [
          redPlane[0] + redPlane[1] * x + redPlane[2] * y,
          greenPlane[0] + greenPlane[1] * x + greenPlane[2] * y,
          bluePlane[0] + bluePlane[1] * x + bluePlane[2] * y
        ];
        for (let channel = 0; channel < 3; channel++) {
          candidate.data[pixelIndex + channel] = clampChannel2(
            candidate.data[pixelIndex + channel] * (1 - strength) + target[channel] * strength
          );
        }
      }
    }
    return { imageData: candidate, stats };
  }
  function refineKnown48FlatBackgroundResidual({
    sourceImageData,
    alphaMap,
    position,
    baselineSpatialScore,
    baselineGradientScore,
    minGradientImprovement = KNOWN_48_FLAT_FILL_MIN_GRADIENT_IMPROVEMENT
  }) {
    if (position?.width < KNOWN_48_EDGE_CLEANUP_MIN_SIZE || position?.width > KNOWN_48_EDGE_CLEANUP_MAX_SIZE || baselineGradientScore < KNOWN_48_FLAT_FILL_MIN_GRADIENT) {
      return null;
    }
    let best = null;
    for (const preset of KNOWN_48_FLAT_FILL_PRESETS) {
      const filled = applyFlatBackgroundFill({
        sourceImageData,
        alphaMap,
        position,
        ...preset
      });
      if (!filled) continue;
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: filled.imageData,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: filled.imageData,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientImprovement = baselineGradientScore - gradientScore;
      const keptSpatial = Math.abs(spatialScore) <= Math.abs(baselineSpatialScore) + KNOWN_48_FLAT_FILL_MAX_SPATIAL_DRIFT;
      const acceptedSpatial = Math.abs(spatialScore) <= KNOWN_48_FLAT_FILL_MAX_ACCEPTED_ABS_SPATIAL;
      if (gradientImprovement < minGradientImprovement || !keptSpatial || !acceptedSpatial) {
        continue;
      }
      const cost = Math.abs(spatialScore) * 0.45 + Math.max(0, gradientScore);
      if (!best || cost < best.cost) {
        best = {
          imageData: filled.imageData,
          spatialScore,
          gradientScore,
          stats: filled.stats,
          preset: preset.name,
          cost
        };
      }
    }
    return best;
  }
  function isNewMargin96AlphaVariantConfig(config) {
    return config?.logoSize === 96 && config.marginRight === 192 && config.marginBottom === 192 && config.alphaVariant === "20260520";
  }
  function refineNewMargin96FlatBackgroundResidual({
    sourceImageData,
    alphaMap,
    position,
    config,
    alphaGain,
    baselineSpatialScore,
    baselineGradientScore
  }) {
    if (!isNewMargin96AlphaVariantConfig(config) || alphaGain !== 1 || position?.width !== 96 || baselineGradientScore < NEW_MARGIN_96_FLAT_FILL_MIN_GRADIENT) {
      return null;
    }
    let best = null;
    for (const preset of NEW_MARGIN_96_FLAT_FILL_PRESETS) {
      const filled = applyFlatBackgroundFill({
        sourceImageData,
        alphaMap,
        position,
        maxBackgroundStd: NEW_MARGIN_96_FLAT_FILL_MAX_BACKGROUND_STD,
        edgeWeightFloor: 0.85,
        ...preset
      });
      if (!filled) continue;
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: filled.imageData,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: filled.imageData,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientImprovement = baselineGradientScore - gradientScore;
      const keptSpatial = Math.abs(spatialScore) <= Math.abs(baselineSpatialScore) + NEW_MARGIN_96_FLAT_FILL_MAX_SPATIAL_DRIFT;
      const acceptedSpatial = Math.abs(spatialScore) <= NEW_MARGIN_96_FLAT_FILL_MAX_ACCEPTED_ABS_SPATIAL;
      if (gradientImprovement < NEW_MARGIN_96_FLAT_FILL_MIN_GRADIENT_IMPROVEMENT || !keptSpatial || !acceptedSpatial) {
        continue;
      }
      const cost = Math.abs(spatialScore) * 0.6 + Math.max(0, gradientScore);
      if (!best || cost < best.cost) {
        best = {
          imageData: filled.imageData,
          spatialScore,
          gradientScore,
          stats: filled.stats,
          preset: preset.name,
          cost
        };
      }
    }
    return best;
  }
  function refineNewMargin96VariantResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    originalSpatialScore,
    originalGradientScore,
    variantAlphaMap
  }) {
    if (!variantAlphaMap || currentConfig?.logoSize !== 96 || currentConfig.marginRight !== 192 || currentConfig.marginBottom !== 192 || currentConfig.alphaVariant === "20260520" || currentPosition?.width !== 96 || currentPosition?.height !== 96 || originalSpatialScore < NEW_MARGIN_96_VARIANT_RESCUE_MIN_ORIGINAL_SPATIAL || originalGradientScore < NEW_MARGIN_96_VARIANT_RESCUE_MIN_ORIGINAL_GRADIENT || currentSpatialScore < NEW_MARGIN_96_VARIANT_RESCUE_MIN_CURRENT_SPATIAL || currentGradientScore > NEW_MARGIN_96_VARIANT_RESCUE_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visibleSpatialResidual !== true) return null;
    let best = null;
    for (const profile of NEW_MARGIN_96_VARIANT_RESCUE_PROFILES) {
      const alphaMap = powerKnown48AlphaMap(variantAlphaMap, profile.exponent);
      const variantOriginalSpatial = computeRegionSpatialCorrelation({
        imageData: originalImageData,
        alphaMap,
        region: {
          x: currentPosition.x,
          y: currentPosition.y,
          size: currentPosition.width
        }
      });
      const variantOriginalGradient = computeRegionGradientCorrelation({
        imageData: originalImageData,
        alphaMap,
        region: {
          x: currentPosition.x,
          y: currentPosition.y,
          size: currentPosition.width
        }
      });
      if (variantOriginalSpatial < NEW_MARGIN_96_VARIANT_RESCUE_MIN_ORIGINAL_SPATIAL || variantOriginalGradient < NEW_MARGIN_96_VARIANT_RESCUE_MIN_ORIGINAL_GRADIENT) {
        continue;
      }
      const candidate = scoreKnown48AntiTemplateRescueCandidate({
        originalImageData,
        alphaMap,
        position: currentPosition,
        alphaGain: profile.alphaGain,
        baselineGradientScore: currentGradientScore,
        maxSpatial: NEW_MARGIN_96_VARIANT_RESCUE_MAX_SPATIAL,
        maxVisualArtifact: NEW_MARGIN_96_VARIANT_RESCUE_MAX_VISUAL_ARTIFACT
      });
      if (!candidate) continue;
      if (candidate.gradientScore > NEW_MARGIN_96_VARIANT_RESCUE_MAX_GRADIENT || (candidate.artifacts?.newlyClippedRatio ?? 0) > NEW_MARGIN_96_VARIANT_RESCUE_MAX_CLIPPED) {
        continue;
      }
      const cost = Math.abs(candidate.spatialScore) + Math.max(0, candidate.gradientScore) * 0.7 + (candidate.artifacts?.visualArtifactCost ?? 0) * 0.35;
      if (!best || cost < best.cost) {
        best = {
          ...candidate,
          config: {
            logoSize: 96,
            marginRight: 192,
            marginBottom: 192,
            alphaVariant: "20260520"
          },
          profileExponent: profile.exponent,
          originalSpatialScore: variantOriginalSpatial,
          originalGradientScore: variantOriginalGradient,
          suppressionGain: variantOriginalSpatial - candidate.spatialScore,
          cost
        };
      }
    }
    return best;
  }
  function pixelLuminance(data, index) {
    return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
  }
  function applyLumaEdgeCorrection({
    sourceImageData,
    alphaMap,
    position,
    minAlpha,
    maxAlpha,
    referenceAlphaMax,
    radius,
    strength,
    colorSigma,
    maxDelta
  }) {
    const candidate = cloneImageData3(sourceImageData);
    const { data, width: imageWidth, height: imageHeight } = sourceImageData;
    const size = position.width;
    const colorSigmaSafe = Math.max(1, colorSigma);
    const edgeMask = createAlphaGradientMask({
      alphaMap,
      width: size,
      height: size
    });
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const localIndex = row * size + col;
        const alpha = alphaMap[localIndex];
        if (alpha < minAlpha || alpha > maxAlpha) continue;
        const x = position.x + col;
        const y = position.y + row;
        const pixelIndex = (y * imageWidth + x) * 4;
        const currentLum = pixelLuminance(data, pixelIndex);
        let weightedLum = 0;
        let sumWeight = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx === 0 && dy === 0) continue;
            const distanceSquared = dx * dx + dy * dy;
            if (distanceSquared > radius * radius) continue;
            const localX = col + dx;
            const localY = row + dy;
            const pixelX = x + dx;
            const pixelY = y + dy;
            if (pixelX < 0 || pixelY < 0 || pixelX >= imageWidth || pixelY >= imageHeight) continue;
            let neighborAlpha = 0;
            if (localX >= 0 && localY >= 0 && localX < size && localY < size) {
              neighborAlpha = alphaMap[localY * size + localX];
            }
            if (neighborAlpha > referenceAlphaMax && neighborAlpha >= alpha) continue;
            const neighborIndex = (pixelY * imageWidth + pixelX) * 4;
            const neighborLum = pixelLuminance(data, neighborIndex);
            const colorDistance = Math.abs(data[pixelIndex] - data[neighborIndex]) + Math.abs(data[pixelIndex + 1] - data[neighborIndex + 1]) + Math.abs(data[pixelIndex + 2] - data[neighborIndex + 2]);
            const colorWeight = Math.exp(
              -(colorDistance * colorDistance) / (2 * colorSigmaSafe * colorSigmaSafe * 9)
            );
            const alphaWeight = neighborAlpha <= referenceAlphaMax ? 1.25 : 0.65;
            const distanceWeight = 1 / Math.sqrt(distanceSquared);
            const weight = colorWeight * alphaWeight * distanceWeight;
            weightedLum += neighborLum * weight;
            sumWeight += weight;
          }
        }
        if (sumWeight <= 0) continue;
        const targetLum = weightedLum / sumWeight;
        const delta = Math.max(-maxDelta, Math.min(maxDelta, targetLum - currentLum)) * strength;
        const edgeWeight = getAlphaGradientWeight(edgeMask, localIndex);
        const scaledStrength = Math.min(1, Math.max(0, alpha / Math.max(maxAlpha, 1e-6))) * edgeWeight;
        const finalDelta = delta * scaledStrength;
        candidate.data[pixelIndex] = clampChannel2(data[pixelIndex] + finalDelta);
        candidate.data[pixelIndex + 1] = clampChannel2(data[pixelIndex + 1] + finalDelta);
        candidate.data[pixelIndex + 2] = clampChannel2(data[pixelIndex + 2] + finalDelta);
      }
    }
    return candidate;
  }
  function refineKnown48LumaEdgeResidual({
    sourceImageData,
    alphaMap,
    position,
    baselineSpatialScore,
    baselineGradientScore
  }) {
    if (position?.width < KNOWN_48_EDGE_CLEANUP_MIN_SIZE || position?.width > KNOWN_48_EDGE_CLEANUP_MAX_SIZE || baselineGradientScore < KNOWN_48_LUMA_EDGE_MIN_GRADIENT) {
      return null;
    }
    let best = null;
    for (const preset of KNOWN_48_LUMA_EDGE_PRESETS) {
      const candidate = applyLumaEdgeCorrection({
        sourceImageData,
        alphaMap,
        position,
        ...preset
      });
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientImprovement = baselineGradientScore - gradientScore;
      const keptSpatial = Math.abs(spatialScore) <= Math.abs(baselineSpatialScore) + KNOWN_48_LUMA_EDGE_MAX_SPATIAL_DRIFT;
      const acceptedSpatial = Math.abs(spatialScore) <= KNOWN_48_LUMA_EDGE_MAX_ACCEPTED_ABS_SPATIAL;
      if (gradientImprovement < KNOWN_48_LUMA_EDGE_MIN_GRADIENT_IMPROVEMENT || !keptSpatial || !acceptedSpatial) {
        continue;
      }
      const cost = Math.abs(spatialScore) * 0.45 + Math.max(0, gradientScore);
      if (!best || cost < best.cost) {
        best = {
          imageData: candidate,
          spatialScore,
          gradientScore,
          preset: preset.name,
          cost
        };
      }
    }
    return best;
  }
  function alphaBandBiasWeight(alpha, {
    outerMinAlpha = 0.12,
    innerMinAlpha = 0.18,
    innerMaxAlpha = 0.35,
    outerMaxAlpha = 0.42
  } = {}) {
    if (alpha < outerMinAlpha || alpha > outerMaxAlpha) return 0;
    if (alpha >= innerMinAlpha && alpha <= innerMaxAlpha) return 1;
    if (alpha < innerMinAlpha) {
      return smoothstep(outerMinAlpha, innerMinAlpha, alpha);
    }
    return 1 - smoothstep(innerMaxAlpha, outerMaxAlpha, alpha);
  }
  function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value >= edge1 ? 1 : 0;
    const t = clamp012((value - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }
  function applyMidCoreBiasCorrection({ sourceImageData, alphaMap, position, positiveHaloLum, strength }) {
    const candidate = cloneImageData3(sourceImageData);
    const bias = Math.max(0, positiveHaloLum) * strength;
    if (bias <= 0) return candidate;
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const alpha = alphaMap[localIndex] ?? 0;
        const weight = alphaBandBiasWeight(alpha);
        if (weight <= 0) continue;
        const pixelIndex = ((position.y + row) * candidate.width + position.x + col) * 4;
        const delta = bias * weight;
        candidate.data[pixelIndex] = clampChannel2(candidate.data[pixelIndex] - delta);
        candidate.data[pixelIndex + 1] = clampChannel2(candidate.data[pixelIndex + 1] - delta);
        candidate.data[pixelIndex + 2] = clampChannel2(candidate.data[pixelIndex + 2] - delta);
      }
    }
    return candidate;
  }
  function positiveBandDelta(imageData, position, alphaMap, minAlpha, maxAlpha) {
    const halo = assessAlphaBandHalo({
      imageData,
      position,
      alphaMap,
      minAlpha,
      maxAlpha,
      outsideAlphaMax: 0.012,
      outerMargin: 4
    });
    return halo.positiveDeltaLum ?? 0;
  }
  function hasDominantMidCoreHalo({ imageData, position, alphaMap }) {
    const edge = positiveBandDelta(imageData, position, alphaMap, 0.02, 0.12);
    const midCore = positiveBandDelta(imageData, position, alphaMap, 0.18, 0.35);
    const highCore = positiveBandDelta(imageData, position, alphaMap, 0.35, 0.78);
    return midCore > edge && midCore > highCore;
  }
  function refineKnown48MidCoreBiasResidual({
    originalImageData,
    currentImageData,
    alphaMap,
    position,
    source,
    alphaGain,
    baselineSpatialScore,
    baselineGradientScore
  }) {
    if (position?.width < KNOWN_48_EDGE_CLEANUP_MIN_SIZE || position?.width > KNOWN_48_EDGE_CLEANUP_MAX_SIZE || typeof source !== "string" || !source.includes("edge-cleanup") || source.includes("v2-small-edge-cleanup")) {
      return null;
    }
    const baselineVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position,
      alphaMap
    });
    if (baselineVisibility?.visiblePositiveHalo !== true || (baselineVisibility.positiveHaloLum ?? 0) < KNOWN_48_MID_CORE_BIAS_MIN_HALO || !hasDominantMidCoreHalo({ imageData: currentImageData, position, alphaMap })) {
      return null;
    }
    const baselineArtifacts = assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: currentImageData,
      alphaMap,
      position,
      alphaGain
    });
    const baselineArtifactCost = Number(baselineArtifacts?.visualArtifactCost);
    if (!Number.isFinite(baselineArtifactCost)) return null;
    const candidate = applyMidCoreBiasCorrection({
      sourceImageData: currentImageData,
      alphaMap,
      position,
      positiveHaloLum: baselineVisibility.positiveHaloLum,
      strength: KNOWN_48_MID_CORE_BIAS_STRENGTH
    });
    const spatialScore = computeRegionSpatialCorrelation({
      imageData: candidate,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const gradientScore = computeRegionGradientCorrelation({
      imageData: candidate,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const residualVisibility = assessWatermarkResidualVisibility({
      imageData: candidate,
      position,
      alphaMap
    });
    const artifacts = assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: candidate,
      alphaMap,
      position,
      alphaGain
    });
    const artifactCost = Number(artifacts?.visualArtifactCost);
    if (!Number.isFinite(artifactCost)) return null;
    const haloReduction = (baselineVisibility.positiveHaloLum ?? 0) - (residualVisibility?.positiveHaloLum ?? 0);
    const gradientDrift = gradientScore - baselineGradientScore;
    const spatialDrift = Math.abs(spatialScore) - Math.abs(baselineSpatialScore);
    const artifactDrift = artifactCost - baselineArtifactCost;
    const newClipDrift = (artifacts?.newlyClippedRatio ?? 0) - (baselineArtifacts?.newlyClippedRatio ?? 0);
    if (haloReduction < KNOWN_48_MID_CORE_BIAS_MIN_HALO_REDUCTION || gradientDrift > KNOWN_48_MID_CORE_BIAS_MAX_GRADIENT_DRIFT || spatialDrift > KNOWN_48_MID_CORE_BIAS_MAX_SPATIAL_DRIFT || artifactDrift > KNOWN_48_MID_CORE_BIAS_MAX_ARTIFACT_DRIFT || newClipDrift > KNOWN_48_MID_CORE_BIAS_MAX_NEW_CLIP_DRIFT) {
      return null;
    }
    return {
      imageData: candidate,
      spatialScore,
      gradientScore,
      residualVisibility,
      cost: artifactCost,
      haloReduction,
      artifactDrift,
      newClipDrift
    };
  }
  function expandPosition(position, imageData, pad) {
    const left = Math.max(0, position.x - pad);
    const top = Math.max(0, position.y - pad);
    const right = Math.min(imageData.width, position.x + position.width + pad);
    const bottom = Math.min(imageData.height, position.y + position.height + pad);
    return {
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    };
  }
  function measureOuterBorderLuminanceStats(imageData, position, margin = 10) {
    let sum = 0;
    let sq = 0;
    let count = 0;
    const left = Math.max(0, position.x - margin);
    const top = Math.max(0, position.y - margin);
    const right = Math.min(imageData.width, position.x + position.width + margin);
    const bottom = Math.min(imageData.height, position.y + position.height + margin);
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const inside = x >= position.x && x < position.x + position.width && y >= position.y && y < position.y + position.height;
        if (inside) continue;
        const idx = (y * imageData.width + x) * 4;
        const lum = 0.2126 * imageData.data[idx] + 0.7152 * imageData.data[idx + 1] + 0.0722 * imageData.data[idx + 2];
        sum += lum;
        sq += lum * lum;
        count++;
      }
    }
    if (count <= 0) {
      return {
        mean: Number.POSITIVE_INFINITY,
        std: Number.POSITIVE_INFINITY,
        count
      };
    }
    const mean = sum / count;
    return {
      mean,
      std: Math.sqrt(Math.max(0, sq / count - mean * mean)),
      count
    };
  }
  function measureOuterBorderLuminanceStd(imageData, position, margin = 10) {
    return measureOuterBorderLuminanceStats(imageData, position, margin).std;
  }
  function clamp012(value) {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
  }
  function clampChannel2(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }
  function estimateAlphaMapFromBackgroundPrior({
    originalImageData,
    priorImageData,
    position,
    threshold,
    blurRadius
  }) {
    const alphaMap = new Float32Array(position.width * position.height);
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const pixelIndex = ((position.y + row) * originalImageData.width + position.x + col) * 4;
        let estimatedAlpha = 0;
        for (let channel = 0; channel < 3; channel++) {
          const denominator = 255 - priorImageData.data[pixelIndex + channel];
          if (denominator <= 2) continue;
          estimatedAlpha = Math.max(
            estimatedAlpha,
            (originalImageData.data[pixelIndex + channel] - priorImageData.data[pixelIndex + channel]) / denominator
          );
        }
        alphaMap[localIndex] = Math.min(0.9, clamp012((estimatedAlpha - threshold) * 1.2));
      }
    }
    return blurRadius > 0 ? blurAlphaMap(alphaMap, position.width, blurRadius) : alphaMap;
  }
  function applyEstimatedPriorBlend({
    sourceImageData,
    priorImageData,
    estimatedAlphaMap,
    position,
    strength,
    gamma
  }) {
    const candidate = cloneImageData3(sourceImageData);
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const alpha = estimatedAlphaMap[localIndex];
        if (alpha <= 5e-3) continue;
        const blend = clamp012(Math.pow(alpha, gamma) * strength);
        if (blend <= 5e-3) continue;
        const pixelIndex = ((position.y + row) * sourceImageData.width + position.x + col) * 4;
        for (let channel = 0; channel < 3; channel++) {
          candidate.data[pixelIndex + channel] = clampChannel2(
            sourceImageData.data[pixelIndex + channel] * (1 - blend) + priorImageData.data[pixelIndex + channel] * blend
          );
        }
      }
    }
    return candidate;
  }
  function refineSmoothLocatedResidualWithEstimatedPrior({
    originalImageData,
    currentImageData,
    alphaMap,
    position,
    source,
    alphaGain,
    baselineSpatialScore,
    baselineGradientScore
  }) {
    if (typeof source !== "string" || !source.includes("located-aggressive") || position?.width < SMOOTH_PRIOR_LOCATED_MIN_SIZE || position?.width > SMOOTH_PRIOR_LOCATED_MAX_SIZE || baselineSpatialScore < SMOOTH_PRIOR_LOCATED_MIN_SPATIAL || baselineGradientScore > SMOOTH_PRIOR_LOCATED_MAX_GRADIENT) {
      return null;
    }
    const borderStats = measureOuterBorderLuminanceStats(originalImageData, position, 16);
    if (borderStats.mean < SMOOTH_PRIOR_LOCATED_MIN_BORDER_MEAN) {
      return null;
    }
    const baselineArtifacts = assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: currentImageData,
      alphaMap,
      position,
      alphaGain
    });
    const baselineArtifactCost = Number(baselineArtifacts?.visualArtifactCost);
    if (!Number.isFinite(baselineArtifactCost)) return null;
    let best = null;
    const priorByRadius = /* @__PURE__ */ new Map();
    for (const preset of SMOOTH_PRIOR_LOCATED_PRESETS) {
      let priorImageData = priorByRadius.get(preset.radius);
      if (!priorImageData) {
        priorImageData = buildPreviewNeighborhoodPrior({
          previewImageData: originalImageData,
          position,
          radius: preset.radius
        });
        priorByRadius.set(preset.radius, priorImageData);
      }
      const estimatedAlphaMap = estimateAlphaMapFromBackgroundPrior({
        originalImageData,
        priorImageData,
        position,
        threshold: preset.threshold,
        blurRadius: preset.blurRadius
      });
      const candidateImageData = applyEstimatedPriorBlend({
        sourceImageData: currentImageData,
        priorImageData,
        estimatedAlphaMap,
        position,
        strength: preset.strength,
        gamma: preset.gamma
      });
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidateImageData,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidateImageData,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const artifacts = assessRemovalDiffArtifacts({
        originalImageData,
        candidateImageData,
        alphaMap,
        position,
        alphaGain
      });
      const artifactCost = Number(artifacts?.visualArtifactCost);
      if (!Number.isFinite(artifactCost)) continue;
      const spatialImprovement = Math.abs(baselineSpatialScore) - Math.abs(spatialScore);
      const gradientDrift = gradientScore - baselineGradientScore;
      const artifactImprovement = baselineArtifactCost - artifactCost;
      if (spatialImprovement < SMOOTH_PRIOR_LOCATED_MIN_SPATIAL_IMPROVEMENT || gradientDrift > SMOOTH_PRIOR_LOCATED_MAX_GRADIENT_DRIFT || artifactImprovement < SMOOTH_PRIOR_LOCATED_MIN_ARTIFACT_IMPROVEMENT || gradientScore > SMOOTH_PRIOR_LOCATED_MAX_ACCEPTED_GRADIENT) {
        continue;
      }
      const cost = Math.abs(spatialScore) * 0.75 + Math.max(0, gradientScore) * 0.9 + artifactCost * 0.5;
      if (!best || cost < best.cost) {
        best = {
          imageData: candidateImageData,
          spatialScore,
          gradientScore,
          cost,
          artifactCost,
          borderStats,
          preset
        };
      }
    }
    return best;
  }
  function averageStripColor2(imageData, {
    xFrom,
    xTo,
    yFrom,
    yTo
  }) {
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    const left = Math.max(0, xFrom);
    const right = Math.min(imageData.width - 1, xTo);
    const top = Math.max(0, yFrom);
    const bottom = Math.min(imageData.height - 1, yTo);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const idx = (y * imageData.width + x) * 4;
        sumR += imageData.data[idx];
        sumG += imageData.data[idx + 1];
        sumB += imageData.data[idx + 2];
        count++;
      }
    }
    if (count <= 0) return [0, 0, 0];
    return [
      sumR / count,
      sumG / count,
      sumB / count
    ];
  }
  function lerpColor2(left, right, t) {
    return [
      left[0] * (1 - t) + right[0] * t,
      left[1] * (1 - t) + right[1] * t,
      left[2] * (1 - t) + right[2] * t
    ];
  }
  function applyPreviewSmoothBackgroundCleanup({
    imageData,
    position
  }) {
    const expandedPosition = expandPosition(
      position,
      imageData,
      PREVIEW_BACKGROUND_CLEANUP_PAD
    );
    const candidate = cloneImageData3(imageData);
    const stripRadius = PREVIEW_BACKGROUND_CLEANUP_PRIOR_RADIUS;
    const leftBoundary = [];
    const rightBoundary = [];
    const topBoundary = [];
    const bottomBoundary = [];
    for (let row = 0; row < expandedPosition.height; row++) {
      const y = expandedPosition.y + row;
      leftBoundary.push(averageStripColor2(imageData, {
        xFrom: expandedPosition.x - stripRadius,
        xTo: expandedPosition.x - 1,
        yFrom: y - 1,
        yTo: y + 1
      }));
      rightBoundary.push(averageStripColor2(imageData, {
        xFrom: expandedPosition.x + expandedPosition.width,
        xTo: expandedPosition.x + expandedPosition.width + stripRadius - 1,
        yFrom: y - 1,
        yTo: y + 1
      }));
    }
    for (let col = 0; col < expandedPosition.width; col++) {
      const x = expandedPosition.x + col;
      topBoundary.push(averageStripColor2(imageData, {
        xFrom: x - 1,
        xTo: x + 1,
        yFrom: expandedPosition.y - stripRadius,
        yTo: expandedPosition.y - 1
      }));
      bottomBoundary.push(averageStripColor2(imageData, {
        xFrom: x - 1,
        xTo: x + 1,
        yFrom: expandedPosition.y + expandedPosition.height,
        yTo: expandedPosition.y + expandedPosition.height + stripRadius - 1
      }));
    }
    for (let row = 0; row < expandedPosition.height; row++) {
      const ty = expandedPosition.height <= 1 ? 0.5 : row / (expandedPosition.height - 1);
      for (let col = 0; col < expandedPosition.width; col++) {
        const tx = expandedPosition.width <= 1 ? 0.5 : col / (expandedPosition.width - 1);
        const horizontal = lerpColor2(leftBoundary[row], rightBoundary[row], tx);
        const vertical = lerpColor2(topBoundary[col], bottomBoundary[col], ty);
        const idx = ((expandedPosition.y + row) * candidate.width + expandedPosition.x + col) * 4;
        candidate.data[idx] = clampChannel2((horizontal[0] + vertical[0]) * 0.5);
        candidate.data[idx + 1] = clampChannel2((horizontal[1] + vertical[1]) * 0.5);
        candidate.data[idx + 2] = clampChannel2((horizontal[2] + vertical[2]) * 0.5);
      }
    }
    return {
      imageData: candidate,
      expandedPosition
    };
  }
  function shouldApplyPreviewSmoothBackgroundCleanup({
    enabled = true,
    source,
    position,
    baselineSpatialScore,
    borderStd
  }) {
    return enabled === true && typeof source === "string" && source.includes("preview-anchor") && position?.width >= 24 && position?.width <= PREVIEW_BACKGROUND_CLEANUP_MAX_SIZE && baselineSpatialScore >= PREVIEW_BACKGROUND_CLEANUP_MIN_RESIDUAL && borderStd <= PREVIEW_BACKGROUND_CLEANUP_MAX_BORDER_STD;
  }
  function refineSmallPreviewAnchorCandidate({
    originalImageData,
    source,
    position,
    originalGradientScore,
    currentSpatialScore,
    currentGradientScore,
    getAlphaMap
  }) {
    if (typeof source !== "string" || !source.includes("preview-anchor") || !source.includes("edge-cleanup") || position?.width > SMALL_PREVIEW_REFINEMENT_MAX_SOURCE_SIZE || originalGradientScore > SMALL_PREVIEW_REFINEMENT_MAX_ORIGINAL_GRADIENT || currentSpatialScore < SMALL_PREVIEW_REFINEMENT_MIN_CURRENT_SPATIAL || currentGradientScore > SMALL_PREVIEW_REFINEMENT_MAX_CURRENT_GRADIENT || typeof getAlphaMap !== "function") {
      return null;
    }
    let best = null;
    const sizeCandidates = [
      position.width + 4,
      position.width + 6,
      position.width + 8
    ].filter((size) => size <= SMALL_PREVIEW_REFINEMENT_MAX_REFINED_SIZE);
    const shiftCandidates = [-8, -6, -4, -2, 0];
    const gainCandidates = ALPHA_GAIN_CANDIDATES.filter((gain) => gain < 1);
    for (const size of sizeCandidates) {
      const alphaMap = getAlphaMap(size);
      if (!alphaMap) continue;
      for (const dy of shiftCandidates) {
        for (const dx of shiftCandidates) {
          const candidatePosition = {
            x: position.x + dx,
            y: position.y + dy,
            width: size,
            height: size
          };
          if (candidatePosition.x < 0 || candidatePosition.y < 0 || candidatePosition.x + size > originalImageData.width || candidatePosition.y + size > originalImageData.height) {
            continue;
          }
          for (const alphaGain of gainCandidates) {
            const originalSpatialScore = computeRegionSpatialCorrelation({
              imageData: originalImageData,
              alphaMap,
              region: { x: candidatePosition.x, y: candidatePosition.y, size }
            });
            const originalGradientScore2 = computeRegionGradientCorrelation({
              imageData: originalImageData,
              alphaMap,
              region: { x: candidatePosition.x, y: candidatePosition.y, size }
            });
            const candidate = cloneImageData3(originalImageData);
            removeWatermark(candidate, alphaMap, candidatePosition, { alphaGain });
            const spatialScore = computeRegionSpatialCorrelation({
              imageData: candidate,
              alphaMap,
              region: { x: candidatePosition.x, y: candidatePosition.y, size }
            });
            const gradientScore = computeRegionGradientCorrelation({
              imageData: candidate,
              alphaMap,
              region: { x: candidatePosition.x, y: candidatePosition.y, size }
            });
            const absSpatialImprovement = Math.abs(currentSpatialScore) - Math.abs(spatialScore);
            const gradientImprovement = currentGradientScore - gradientScore;
            if (absSpatialImprovement < SMALL_PREVIEW_REFINEMENT_MIN_ABS_SPATIAL_IMPROVEMENT || gradientImprovement < SMALL_PREVIEW_REFINEMENT_MIN_GRADIENT_IMPROVEMENT) {
              continue;
            }
            const nearBlackRatio = calculateNearBlackRatio(candidate, candidatePosition);
            const cost = Math.abs(spatialScore) + Math.max(0, gradientScore) * 0.8 + nearBlackRatio * 2;
            if (!best || cost < best.cost) {
              best = {
                imageData: candidate,
                alphaMap,
                alphaGain,
                position: candidatePosition,
                originalSpatialScore,
                originalGradientScore: originalGradientScore2,
                spatialScore,
                gradientScore,
                nearBlackRatio,
                cost
              };
            }
          }
        }
      }
    }
    return best;
  }
  function refinePreviewResidualEdge({
    sourceImageData,
    alphaMap,
    position,
    source,
    baselineSpatialScore,
    baselineGradientScore,
    minGradientImprovement = PREVIEW_EDGE_CLEANUP_MIN_GRADIENT_IMPROVEMENT,
    maxSpatialDrift = PREVIEW_EDGE_CLEANUP_MAX_SPATIAL_DRIFT,
    allowAggressivePresets = false,
    mode = "preview"
  }) {
    const baselineHalo = assessAlphaBandHalo({
      imageData: sourceImageData,
      position,
      alphaMap
    });
    const baselinePositiveHalo = baselineHalo.positiveDeltaLum;
    if (!shouldRefineResidualEdge({
      source,
      position,
      baselineSpatialScore,
      baselineGradientScore,
      baselinePositiveHalo,
      mode
    })) {
      return null;
    }
    const baselineNearBlackRatio = calculateNearBlackRatio(sourceImageData, position);
    const maxAllowedNearBlackRatio = Math.min(1, baselineNearBlackRatio + MAX_NEAR_BLACK_RATIO_INCREASE3);
    const resolvedMinGradientImprovement = baselineGradientScore <= PREVIEW_EDGE_CLEANUP_FINE_GRADIENT_THRESHOLD ? PREVIEW_EDGE_CLEANUP_FINE_MIN_GRADIENT_IMPROVEMENT : baselinePositiveHalo >= PREVIEW_EDGE_CLEANUP_STRONG_HALO_THRESHOLD ? PREVIEW_EDGE_CLEANUP_HALO_RELAXED_MIN_GRADIENT_IMPROVEMENT : minGradientImprovement;
    const smallPreviewPresets = mode === "preview" && position?.width >= 24 && position?.width <= SMALL_PREVIEW_EDGE_CLEANUP_MAX_SIZE ? SMALL_PREVIEW_EDGE_CLEANUP_PRESETS : [];
    const presets = allowAggressivePresets && baselineGradientScore >= PREVIEW_EDGE_CLEANUP_STRONG_GRADIENT_THRESHOLD && Math.abs(baselineSpatialScore) <= 0.05 ? [...PREVIEW_EDGE_CLEANUP_PRESETS, ...PREVIEW_EDGE_CLEANUP_AGGRESSIVE_PRESETS] : [...PREVIEW_EDGE_CLEANUP_PRESETS, ...smallPreviewPresets];
    let best = null;
    for (const preset of presets) {
      const candidate = blendPreviewResidualEdge({
        sourceImageData,
        alphaMap,
        position,
        ...preset
      });
      const nearBlackRatio = calculateNearBlackRatio(candidate, position);
      if (nearBlackRatio > maxAllowedNearBlackRatio) continue;
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidate,
        alphaMap,
        region: { x: position.x, y: position.y, size: position.width }
      });
      const halo = assessAlphaBandHalo({
        imageData: candidate,
        position,
        alphaMap
      });
      const presetMinGradientImprovement = preset.minGradientImprovement ?? resolvedMinGradientImprovement;
      const presetMaxSpatialDrift = preset.maxSpatialDrift ?? maxSpatialDrift;
      const presetMaxAcceptedSpatial = preset.maxAcceptedSpatial ?? 0.22;
      const improvedGradient = gradientScore <= baselineGradientScore - presetMinGradientImprovement;
      const keptSpatial = Math.abs(spatialScore) <= Math.abs(baselineSpatialScore) + presetMaxSpatialDrift;
      const keptResidualWithinTarget = Math.abs(spatialScore) <= presetMaxAcceptedSpatial;
      const candidatePositiveHalo = halo.positiveDeltaLum;
      const improvedHalo = baselinePositiveHalo < PREVIEW_EDGE_CLEANUP_STRONG_HALO_THRESHOLD || candidatePositiveHalo <= baselinePositiveHalo - PREVIEW_EDGE_CLEANUP_MIN_HALO_REDUCTION;
      if (!improvedGradient || !keptSpatial || !keptResidualWithinTarget || !improvedHalo) continue;
      const cost = Math.abs(spatialScore) * 0.6 + Math.max(0, gradientScore) + candidatePositiveHalo * PREVIEW_EDGE_CLEANUP_HALO_WEIGHT;
      if (!best || cost < best.cost) {
        best = {
          imageData: candidate,
          spatialScore,
          gradientScore,
          halo,
          cost
        };
      }
    }
    if (!best || !(mode === "preview" && position?.width >= 24 && position?.width <= SMALL_PREVIEW_EDGE_CLEANUP_MAX_SIZE)) {
      return best;
    }
    const flatFilled = applySmallPreviewBrightBackgroundFill({
      sourceImageData: best.imageData,
      alphaMap,
      position,
      ...SMALL_PREVIEW_FLAT_FILL_PRESET
    });
    if (!flatFilled) return best;
    if (flatFilled.stats.mean < SMALL_PREVIEW_FLAT_FILL_MIN_BACKGROUND_MEAN || flatFilled.stats.std > SMALL_PREVIEW_FLAT_FILL_MAX_BACKGROUND_STD) {
      return best;
    }
    const flatSpatialScore = computeRegionSpatialCorrelation({
      imageData: flatFilled.imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const flatGradientScore = computeRegionGradientCorrelation({
      imageData: flatFilled.imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    if (Math.abs(flatSpatialScore) > SMALL_PREVIEW_FLAT_FILL_MAX_ABS_SPATIAL || flatGradientScore > SMALL_PREVIEW_FLAT_FILL_MAX_GRADIENT) {
      return best;
    }
    return {
      ...best,
      imageData: flatFilled.imageData,
      spatialScore: flatSpatialScore,
      gradientScore: flatGradientScore,
      flatFillStats: flatFilled.stats,
      cost: Math.abs(flatSpatialScore) * 0.6 + Math.max(0, flatGradientScore)
    };
  }
  function scoreLocatedAggressiveCandidate({
    imageData,
    originalImageData,
    alphaMap,
    position,
    alphaGain = 1,
    baselineGradientScore = null
  }) {
    const spatialScore = computeRegionSpatialCorrelation({
      imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const gradientScore = computeRegionGradientCorrelation({
      imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const nearBlackRatio = calculateNearBlackRatio(imageData, position);
    const baselineNearBlackRatio = originalImageData ? calculateNearBlackRatio(originalImageData, position) : nearBlackRatio;
    const artifacts = originalImageData ? assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: imageData,
      alphaMap,
      position,
      alphaGain
    }) : null;
    const balancedVisual = scoreBalancedVisualCandidate({
      processedSpatial: spatialScore,
      processedGradient: gradientScore,
      nearBlackIncrease: nearBlackRatio - baselineNearBlackRatio,
      newlyClippedRatio: artifacts?.newlyClippedRatio,
      darkHaloLum: Math.max(0, -(artifacts?.halo?.deltaLum ?? 0)),
      visualArtifactCost: artifacts?.visualArtifactCost,
      gradientIncrease: Number.isFinite(baselineGradientScore) ? gradientScore - baselineGradientScore : 0
    });
    return {
      spatialScore,
      gradientScore,
      nearBlackRatio,
      artifacts,
      balancedVisual,
      cost: balancedVisual.score
    };
  }
  function pickLocatedAggressiveCandidate(currentBest, candidate) {
    if (!candidate) return currentBest;
    if (!currentBest || candidate.cost < currentBest.cost) return candidate;
    return currentBest;
  }
  function buildLocatedAggressiveCandidate({
    originalImageData,
    sourceImageData,
    alphaMap,
    position,
    alphaGain,
    repeatCount,
    baselineGradientScore
  }) {
    const candidate = cloneImageData3(sourceImageData);
    for (let passIndex = 0; passIndex < repeatCount; passIndex++) {
      removeWatermark(candidate, alphaMap, position, { alphaGain });
    }
    return {
      imageData: candidate,
      alphaGain,
      repeatCount,
      ...scoreLocatedAggressiveCandidate({
        imageData: candidate,
        originalImageData,
        alphaMap,
        position,
        alphaGain,
        baselineGradientScore
      })
    };
  }
  function refineLocatedAggressiveRemoval({
    originalImageData,
    currentImageData,
    alphaMap,
    position,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    onRejected = null
  }) {
    if (!position || !alphaMap || position.width !== position.height) return null;
    const current = {
      imageData: currentImageData,
      alphaGain: currentAlphaGain,
      repeatCount: 0,
      spatialScore: currentSpatialScore,
      gradientScore: currentGradientScore,
      nearBlackRatio: calculateNearBlackRatio(currentImageData, position),
      ...scoreLocatedAggressiveCandidate({
        imageData: currentImageData,
        originalImageData,
        alphaMap,
        position,
        alphaGain: currentAlphaGain,
        baselineGradientScore: currentGradientScore
      })
    };
    let best = current;
    const gains = new Set([
      currentAlphaGain,
      ...LOCATED_AGGRESSIVE_ALPHA_GAINS
    ].filter((value) => Number.isFinite(value) && value > 0));
    for (const alphaGain of gains) {
      for (const repeatCount of [1, 2]) {
        best = pickLocatedAggressiveCandidate(
          best,
          buildLocatedAggressiveCandidate({
            originalImageData,
            sourceImageData: originalImageData,
            alphaMap,
            position,
            alphaGain,
            repeatCount,
            baselineGradientScore: currentGradientScore
          })
        );
      }
    }
    const edgeSources = [{
      imageData: best.imageData,
      alphaGain: best.alphaGain,
      repeatCount: best.repeatCount
    }];
    if (best.imageData !== currentImageData) {
      edgeSources.push({
        imageData: currentImageData,
        alphaGain: currentAlphaGain,
        repeatCount: 0
      });
    }
    for (const edgeSource of edgeSources) {
      for (const preset of LOCATED_AGGRESSIVE_EDGE_PRESETS) {
        const edgeCandidate = blendPreviewResidualEdge({
          sourceImageData: edgeSource.imageData,
          alphaMap,
          position,
          ...preset
        });
        best = pickLocatedAggressiveCandidate(best, {
          imageData: edgeCandidate,
          alphaGain: edgeSource.alphaGain,
          repeatCount: edgeSource.repeatCount,
          edgeCleanup: true,
          ...scoreLocatedAggressiveCandidate({
            imageData: edgeCandidate,
            originalImageData,
            alphaMap,
            position,
            alphaGain: edgeSource.alphaGain,
            baselineGradientScore: currentGradientScore
          })
        });
      }
    }
    if (best.imageData === currentImageData) return null;
    const currentSpatialPassable = current.spatialScore <= LOCATED_AGGRESSIVE_PASSABLE_SPATIAL_THRESHOLD;
    const bestSpatialFails = best.spatialScore > LOCATED_AGGRESSIVE_PASSABLE_SPATIAL_THRESHOLD;
    const spatialDrift = best.spatialScore - current.spatialScore;
    if (currentSpatialPassable && bestSpatialFails && spatialDrift > LOCATED_AGGRESSIVE_MAX_PASSABLE_SPATIAL_DRIFT) {
      if (typeof onRejected === "function") {
        onRejected({
          strategy: "located-aggressive-alpha",
          blockedGate: "passable-spatial-drift",
          currentSpatialScore: current.spatialScore,
          candidateSpatialScore: best.spatialScore,
          spatialDrift,
          currentGradientScore: current.gradientScore,
          candidateGradientScore: best.gradientScore,
          currentCost: current.cost,
          candidateCost: best.cost,
          alphaGain: best.alphaGain,
          repeatCount: best.repeatCount,
          edgeCleanup: best.edgeCleanup === true
        });
      }
      return null;
    }
    if (best.cost > current.cost - LOCATED_AGGRESSIVE_MIN_BALANCED_GAIN) {
      if (typeof onRejected === "function") {
        onRejected({
          strategy: "located-aggressive-alpha",
          blockedGate: "insufficient-balanced-gain",
          currentSpatialScore: current.spatialScore,
          candidateSpatialScore: best.spatialScore,
          spatialDrift: best.spatialScore - current.spatialScore,
          currentGradientScore: current.gradientScore,
          candidateGradientScore: best.gradientScore,
          currentCost: current.cost,
          candidateCost: best.cost,
          alphaGain: best.alphaGain,
          repeatCount: best.repeatCount,
          edgeCleanup: best.edgeCleanup === true
        });
      }
      return null;
    }
    return best;
  }
  function shouldSkipLocatedAggressiveForCleanCanonical96({
    config,
    alphaGain,
    originalSpatialScore,
    originalGradientScore,
    currentSpatialScore,
    currentGradientScore
  }) {
    if (config?.logoSize !== 96 || config.marginRight !== 64 || config.marginBottom !== 64) {
      return false;
    }
    const resolvedAlphaGain = Number(alphaGain);
    const originalSpatial = Number(originalSpatialScore);
    const originalGradient = Number(originalGradientScore);
    const currentSpatial = Number(currentSpatialScore);
    const currentGradient = Number(currentGradientScore);
    if (!Number.isFinite(resolvedAlphaGain) || !Number.isFinite(originalSpatial) || !Number.isFinite(originalGradient) || !Number.isFinite(currentSpatial) || !Number.isFinite(currentGradient)) {
      return false;
    }
    const cleanStandardAlpha = resolvedAlphaGain <= 1 && currentSpatial >= 0 && currentSpatial <= 0.35 && Math.max(0, currentGradient) <= 0.08;
    const cleanBalancedAlpha = resolvedAlphaGain <= 1.1 && currentSpatial >= 0 && currentSpatial <= 0.22 && Math.max(0, currentGradient) <= 0.1;
    const cleanModerateSignalStandardAlpha = resolvedAlphaGain <= 1 && currentSpatial >= 0 && currentSpatial <= CANONICAL_96_MODERATE_SIGNAL_MAX_CURRENT_SPATIAL && Math.max(0, currentGradient) <= CANONICAL_96_MODERATE_SIGNAL_MAX_CURRENT_GRADIENT;
    return originalSpatial >= 0.55 && originalGradient >= 0.2 && (cleanStandardAlpha || cleanBalancedAlpha) || originalSpatial >= CANONICAL_96_MODERATE_SIGNAL_MIN_ORIGINAL_SPATIAL && originalGradient >= CANONICAL_96_MODERATE_SIGNAL_MIN_ORIGINAL_GRADIENT && cleanModerateSignalStandardAlpha;
  }
  function isCanonical96Config(config) {
    return config?.logoSize === 96 && config.marginRight === 64 && config.marginBottom === 64;
  }
  function luminanceAt(imageData, pixelIndex) {
    return 0.2126 * imageData.data[pixelIndex] + 0.7152 * imageData.data[pixelIndex + 1] + 0.0722 * imageData.data[pixelIndex + 2];
  }
  function repairCanonical96DarkClipResidual({ sourceImageData, priorImageData, alphaMap, position }) {
    const candidate = cloneImageData3(sourceImageData);
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const alpha = alphaMap[localIndex] ?? 0;
        if (alpha < CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_MIN_ALPHA) continue;
        const pixelIndex = ((position.y + row) * candidate.width + position.x + col) * 4;
        const sourceLum = luminanceAt(sourceImageData, pixelIndex);
        const priorLum = luminanceAt(priorImageData, pixelIndex);
        if (priorLum - sourceLum < CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_THRESHOLD) {
          continue;
        }
        const blend = clamp012(
          Math.pow(alpha, CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_GAMMA) * CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_STRENGTH
        );
        if (blend <= 5e-3) continue;
        for (let channel = 0; channel < 3; channel++) {
          candidate.data[pixelIndex + channel] = clampChannel2(
            sourceImageData.data[pixelIndex + channel] * (1 - blend) + priorImageData.data[pixelIndex + channel] * blend
          );
        }
      }
    }
    return candidate;
  }
  function refineCanonical96PositiveHaloResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore
  }) {
    if (!isCanonical96Config(currentConfig) || currentPosition?.width !== 96 || currentPosition?.height !== 96 || originalSpatialScore < CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_ORIGINAL_SPATIAL || originalGradientScore < CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_ORIGINAL_GRADIENT || Math.abs(currentSpatialScore) > CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_ABS_CURRENT_SPATIAL || currentGradientScore > CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const baselineVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (baselineVisibility?.visiblePositiveHalo !== true || (baselineVisibility.positiveHaloLum ?? 0) < CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_HALO) {
      return null;
    }
    const alphaMap = currentAlphaMap;
    const baseImageData = cloneImageData3(originalImageData);
    removeWatermark(baseImageData, alphaMap, currentPosition, {
      alphaGain: CANONICAL_96_POSITIVE_HALO_RESCUE_ALPHA_GAIN
    });
    const priorImageData = buildPreviewNeighborhoodPrior({
      previewImageData: baseImageData,
      position: currentPosition,
      radius: CANONICAL_96_POSITIVE_HALO_RESCUE_REPAIR_RADIUS
    });
    const imageData = repairCanonical96DarkClipResidual({
      sourceImageData: baseImageData,
      priorImageData,
      alphaMap,
      position: currentPosition
    });
    const spatialScore = computeRegionSpatialCorrelation({
      imageData,
      alphaMap,
      region: { x: currentPosition.x, y: currentPosition.y, size: currentPosition.width }
    });
    const gradientScore = computeRegionGradientCorrelation({
      imageData,
      alphaMap,
      region: { x: currentPosition.x, y: currentPosition.y, size: currentPosition.width }
    });
    const residualVisibility = assessWatermarkResidualVisibility({
      imageData,
      position: currentPosition,
      alphaMap
    });
    const artifacts = assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: imageData,
      alphaMap,
      position: currentPosition,
      alphaGain: CANONICAL_96_POSITIVE_HALO_RESCUE_ALPHA_GAIN
    });
    const haloReduction = (baselineVisibility.positiveHaloLum ?? 0) - (residualVisibility?.positiveHaloLum ?? 0);
    if (residualVisibility?.visible !== false || (residualVisibility.positiveHaloLum ?? 0) > CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_POSITIVE_HALO || haloReduction < CANONICAL_96_POSITIVE_HALO_RESCUE_MIN_HALO_REDUCTION || Math.abs(spatialScore) > CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_SPATIAL || gradientScore > CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_GRADIENT || (artifacts?.visualArtifactCost ?? 0) > CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_VISUAL_ARTIFACT || (artifacts?.newlyClippedRatio ?? 0) > CANONICAL_96_POSITIVE_HALO_RESCUE_MAX_NEWLY_CLIPPED) {
      return null;
    }
    const originalSpatial = computeRegionSpatialCorrelation({
      imageData: originalImageData,
      alphaMap,
      region: { x: currentPosition.x, y: currentPosition.y, size: currentPosition.width }
    });
    const originalGradient = computeRegionGradientCorrelation({
      imageData: originalImageData,
      alphaMap,
      region: { x: currentPosition.x, y: currentPosition.y, size: currentPosition.width }
    });
    const balancedVisual = scoreBalancedVisualCandidate({
      processedSpatial: spatialScore,
      processedGradient: gradientScore,
      newlyClippedRatio: artifacts?.newlyClippedRatio,
      visualArtifactCost: artifacts?.visualArtifactCost
    });
    return {
      imageData,
      alphaMap,
      position: currentPosition,
      config: currentConfig,
      alphaGain: CANONICAL_96_POSITIVE_HALO_RESCUE_ALPHA_GAIN,
      originalSpatialScore: originalSpatial,
      originalGradientScore: originalGradient,
      spatialScore,
      gradientScore,
      residualVisibility,
      artifacts,
      haloReduction,
      suppressionGain: originalSpatial - spatialScore,
      cost: balancedVisual.score
    };
  }
  function shouldRelocateSmallFixedLocalAnchor({
    source,
    config,
    position,
    currentGradientScore,
    currentResidualVisibility
  }) {
    const sourceText = String(source || "");
    if (!sourceText.includes("fixed-local")) return false;
    if (!position || position.width !== position.height || position.width < SMALL_ANCHOR_RELOCATION_MIN_SIZE || position.width > SMALL_ANCHOR_RELOCATION_MAX_SIZE) {
      return false;
    }
    if (!config || config.logoSize < SMALL_ANCHOR_RELOCATION_MIN_SIZE || config.logoSize > SMALL_ANCHOR_RELOCATION_MAX_SIZE) {
      return false;
    }
    if (!currentResidualVisibility?.visible) return false;
    return currentResidualVisibility.visiblePositiveHalo === true || currentGradientScore >= SMALL_ANCHOR_RELOCATION_MIN_CURRENT_GRADIENT;
  }
  function resolveRelocationAlphaMap({ size, currentAlphaMap, currentPosition, alpha96, getAlphaMap }) {
    if (size === currentPosition?.width) return currentAlphaMap;
    if (typeof getAlphaMap === "function") {
      const resolved = getAlphaMap(size);
      if (resolved) return resolved;
    }
    return interpolateAlphaMap(alpha96, 96, size);
  }
  function buildSmallAnchorRelocationCandidate({
    originalImageData,
    alphaMap,
    size,
    marginRight,
    marginBottom,
    alphaGain
  }) {
    const position = {
      x: originalImageData.width - marginRight - size,
      y: originalImageData.height - marginBottom - size,
      width: size,
      height: size
    };
    if (position.x < 0 || position.y < 0 || position.x + size > originalImageData.width || position.y + size > originalImageData.height) {
      return null;
    }
    const originalSpatialScore = computeRegionSpatialCorrelation({
      imageData: originalImageData,
      alphaMap,
      region: { x: position.x, y: position.y, size }
    });
    if (originalSpatialScore < SMALL_ANCHOR_RELOCATION_MIN_ORIGINAL_SPATIAL) {
      return null;
    }
    const originalGradientScore = computeRegionGradientCorrelation({
      imageData: originalImageData,
      alphaMap,
      region: { x: position.x, y: position.y, size }
    });
    const candidateImageData = cloneImageData3(originalImageData);
    removeWatermark(candidateImageData, alphaMap, position, { alphaGain });
    const spatialScore = computeRegionSpatialCorrelation({
      imageData: candidateImageData,
      alphaMap,
      region: { x: position.x, y: position.y, size }
    });
    const gradientScore = computeRegionGradientCorrelation({
      imageData: candidateImageData,
      alphaMap,
      region: { x: position.x, y: position.y, size }
    });
    const suppressionGain = originalSpatialScore - spatialScore;
    if (Math.abs(spatialScore) > SMALL_ANCHOR_RELOCATION_MAX_ACCEPTED_SPATIAL || gradientScore > SMALL_ANCHOR_RELOCATION_MAX_ACCEPTED_GRADIENT || suppressionGain < SMALL_ANCHOR_RELOCATION_MIN_SUPPRESSION_GAIN) {
      return null;
    }
    const residualVisibility = assessWatermarkResidualVisibility({
      imageData: candidateImageData,
      position,
      alphaMap
    });
    if (residualVisibility.visible) return null;
    return {
      imageData: candidateImageData,
      alphaMap,
      position,
      config: { logoSize: size, marginRight, marginBottom },
      alphaGain,
      originalSpatialScore,
      originalGradientScore,
      spatialScore,
      gradientScore,
      suppressionGain,
      residualVisibility,
      cost: Math.abs(spatialScore) * 0.8 + Math.max(0, gradientScore) * 0.75 + Math.max(0, residualVisibility.positiveHaloLum ?? 0) * 0.01
    };
  }
  function refineSmallFixedLocalAnchorGeometry({
    originalImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSource,
    currentGradientScore,
    currentResidualVisibility,
    alpha96,
    getAlphaMap
  }) {
    if (!shouldRelocateSmallFixedLocalAnchor({
      source: currentSource,
      config: currentConfig,
      position: currentPosition,
      currentGradientScore,
      currentResidualVisibility
    })) {
      return null;
    }
    const currentSize = currentConfig.logoSize ?? currentPosition.width;
    const currentMarginRight = currentConfig.marginRight;
    const currentMarginBottom = currentConfig.marginBottom;
    if (![currentSize, currentMarginRight, currentMarginBottom].every(Number.isFinite)) {
      return null;
    }
    let best = null;
    const minSize = Math.max(SMALL_ANCHOR_RELOCATION_MIN_SIZE, currentSize);
    const maxSize = Math.min(SMALL_ANCHOR_RELOCATION_MAX_SIZE, currentSize + SMALL_ANCHOR_RELOCATION_SIZE_DELTA);
    const minMarginRight = Math.max(0, currentMarginRight - SMALL_ANCHOR_RELOCATION_MARGIN_DELTA);
    const maxMarginRight = currentMarginRight + SMALL_ANCHOR_RELOCATION_MARGIN_DELTA;
    const minMarginBottom = Math.max(0, currentMarginBottom - SMALL_ANCHOR_RELOCATION_MARGIN_DELTA);
    const maxMarginBottom = currentMarginBottom + SMALL_ANCHOR_RELOCATION_MARGIN_DELTA;
    for (let size = minSize; size <= maxSize; size++) {
      const alphaMap = resolveRelocationAlphaMap({
        size,
        currentAlphaMap,
        currentPosition,
        alpha96,
        getAlphaMap
      });
      if (!alphaMap) continue;
      for (let marginRight = minMarginRight; marginRight <= maxMarginRight; marginRight++) {
        for (let marginBottom = minMarginBottom; marginBottom <= maxMarginBottom; marginBottom++) {
          const candidateY = originalImageData.height - marginBottom - size;
          if (candidateY > currentPosition.y + 1) continue;
          for (const candidateAlphaGain of ALPHA_GAIN_CANDIDATES) {
            const candidate = buildSmallAnchorRelocationCandidate({
              originalImageData,
              alphaMap,
              size,
              marginRight,
              marginBottom,
              alphaGain: candidateAlphaGain
            });
            if (!candidate) continue;
            if (!best || candidate.cost < best.cost) {
              best = candidate;
            }
          }
        }
      }
    }
    return best;
  }
  function isKnown48LargeMarginConfig(config) {
    if (!config || config.logoSize !== 48) return false;
    return Math.abs(Number(config.marginRight) - 96) <= 2 && Math.abs(Number(config.marginBottom) - 96) <= 2;
  }
  function sharpenKnown48AlphaMap(alphaMap, size, amount) {
    const sharpened = new Float32Array(alphaMap.length);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const sourceY = y + dy;
          if (sourceY < 0 || sourceY >= size) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const sourceX = x + dx;
            if (sourceX < 0 || sourceX >= size) continue;
            sum += alphaMap[sourceY * size + sourceX];
            count++;
          }
        }
        const index = y * size + x;
        const blurred = count > 0 ? sum / count : alphaMap[index];
        sharpened[index] = Math.max(0, Math.min(0.99, alphaMap[index] + (alphaMap[index] - blurred) * amount));
      }
    }
    return sharpened;
  }
  function scaleKnown48AlphaBand(alphaMap, { minAlpha, maxAlpha, scale }) {
    const scaled = new Float32Array(alphaMap.length);
    for (let index = 0; index < alphaMap.length; index++) {
      const alpha = alphaMap[index];
      scaled[index] = alpha >= minAlpha && alpha <= maxAlpha ? Math.max(0, Math.min(0.99, alpha * scale)) : alpha;
    }
    return scaled;
  }
  function powerKnown48AlphaMap(alphaMap, exponent) {
    const transformed = new Float32Array(alphaMap.length);
    for (let index = 0; index < alphaMap.length; index++) {
      transformed[index] = Math.max(0, Math.min(0.99, Math.pow(alphaMap[index], exponent)));
    }
    return transformed;
  }
  function scoreKnown48AntiTemplateRescueCandidate({
    originalImageData,
    alphaMap,
    position,
    alphaGain,
    baselineGradientScore,
    logoValue = void 0,
    maxSpatial = KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_SPATIAL,
    maxVisualArtifact = KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_VISUAL_ARTIFACT
  }) {
    const imageData = cloneImageData3(originalImageData);
    removeWatermark(imageData, alphaMap, position, { alphaGain, logoValue });
    const spatialScore = computeRegionSpatialCorrelation({
      imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const gradientScore = computeRegionGradientCorrelation({
      imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    if (Math.abs(spatialScore) > maxSpatial || Math.max(0, gradientScore) > KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_GRADIENT) {
      return null;
    }
    const residualVisibility = assessWatermarkResidualVisibility({
      imageData,
      position,
      alphaMap
    });
    if (residualVisibility?.visible !== false) return null;
    const nearBlackRatio = calculateNearBlackRatio(imageData, position);
    const baselineNearBlackRatio = calculateNearBlackRatio(originalImageData, position);
    const artifacts = assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: imageData,
      alphaMap,
      position,
      alphaGain
    });
    const darkHaloLum = Math.max(0, -(artifacts?.halo?.deltaLum ?? 0));
    const visualArtifactCost = artifacts?.visualArtifactCost ?? 0;
    if (darkHaloLum > KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_DARK_HALO || visualArtifactCost > maxVisualArtifact) {
      return null;
    }
    const balancedVisual = scoreBalancedVisualCandidate({
      processedSpatial: spatialScore,
      processedGradient: gradientScore,
      nearBlackIncrease: nearBlackRatio - baselineNearBlackRatio,
      newlyClippedRatio: artifacts?.newlyClippedRatio,
      darkHaloLum,
      visualArtifactCost,
      gradientIncrease: Number.isFinite(baselineGradientScore) ? gradientScore - baselineGradientScore : 0
    });
    return {
      imageData,
      alphaMap,
      position,
      config: {
        logoSize: position.width,
        marginRight: originalImageData.width - position.x - position.width,
        marginBottom: originalImageData.height - position.y - position.height
      },
      alphaGain,
      logoValue,
      spatialScore,
      gradientScore,
      residualVisibility,
      nearBlackRatio,
      artifacts,
      balancedVisual,
      cost: balancedVisual.score
    };
  }
  function refineKnown48AntiTemplateResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore
  }) {
    const hasStrongOriginalEvidence = originalSpatialScore >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_SPATIAL && originalGradientScore >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_GRADIENT;
    const hasWeakOriginalEvidence = originalSpatialScore >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_SPATIAL && originalGradientScore >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_GRADIENT;
    const hasMidBoostEntryEvidence = originalSpatialScore < KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_SPATIAL && currentSpatialScore <= KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_CURRENT_SPATIAL && currentGradientScore <= KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_CURRENT_GRADIENT;
    if (!isKnown48LargeMarginConfig(currentConfig) || !currentPosition || currentPosition.width !== currentPosition.height || !hasStrongOriginalEvidence && !hasWeakOriginalEvidence && !hasMidBoostEntryEvidence || currentSpatialScore > KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_CURRENT_SPATIAL || Math.max(0, currentGradientScore) > KNOWN_48_ANTI_TEMPLATE_RESCUE_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visible !== true || currentVisibility.visiblePositiveHalo === true) return null;
    const currentScore = scoreKnown48AntiTemplateRescueCandidate({
      originalImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain,
      baselineGradientScore: currentGradientScore
    });
    const currentCost = currentScore?.cost ?? scoreLocatedAggressiveCandidate({
      imageData: currentImageData,
      originalImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain,
      baselineGradientScore: currentGradientScore
    }).cost;
    let best = null;
    const minSize = Math.max(KNOWN_48_EDGE_CLEANUP_MIN_SIZE, currentConfig.logoSize - 2);
    const maxSize = Math.min(KNOWN_48_EDGE_CLEANUP_MAX_SIZE, currentConfig.logoSize + 1);
    const minMarginRight = Math.max(0, currentConfig.marginRight - 1);
    const maxMarginRight = currentConfig.marginRight + 2;
    const minMarginBottom = Math.max(0, currentConfig.marginBottom - 1);
    const maxMarginBottom = currentConfig.marginBottom + 2;
    for (let size = minSize; size <= maxSize; size++) {
      const alphaMap = size === currentPosition.width ? currentAlphaMap : interpolateAlphaMap(currentAlphaMap, currentPosition.width, size);
      if (!alphaMap) continue;
      for (let marginRight = minMarginRight; marginRight <= maxMarginRight; marginRight++) {
        for (let marginBottom = minMarginBottom; marginBottom <= maxMarginBottom; marginBottom++) {
          const position = {
            x: originalImageData.width - marginRight - size,
            y: originalImageData.height - marginBottom - size,
            width: size,
            height: size
          };
          if (position.x < 0 || position.y < 0 || position.x + size > originalImageData.width || position.y + size > originalImageData.height) {
            continue;
          }
          const originalSpatial = computeRegionSpatialCorrelation({
            imageData: originalImageData,
            alphaMap,
            region: { x: position.x, y: position.y, size }
          });
          const originalGradient = computeRegionGradientCorrelation({
            imageData: originalImageData,
            alphaMap,
            region: { x: position.x, y: position.y, size }
          });
          const hasCandidateStrongEvidence = originalSpatial >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_SPATIAL && originalGradient >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_GRADIENT;
          const hasCandidateWeakEvidence = originalSpatial >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_SPATIAL && originalGradient >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_GRADIENT;
          if (!hasCandidateStrongEvidence && !hasCandidateWeakEvidence) {
            continue;
          }
          for (const alphaGain of KNOWN_48_ANTI_TEMPLATE_RESCUE_GAINS) {
            const candidate = scoreKnown48AntiTemplateRescueCandidate({
              originalImageData,
              alphaMap,
              position,
              alphaGain,
              baselineGradientScore: currentGradientScore
            });
            if (!candidate) continue;
            if (!best || candidate.cost < best.cost) {
              best = {
                ...candidate,
                originalSpatialScore: originalSpatial,
                originalGradientScore: originalGradient,
                suppressionGain: originalSpatial - candidate.spatialScore
              };
            }
          }
        }
      }
    }
    if (currentPosition.width === 48 && currentPosition.height === 48) {
      const sharpenedAlphaMap = sharpenKnown48AlphaMap(
        currentAlphaMap,
        48,
        KNOWN_48_ANTI_TEMPLATE_RESCUE_SHARPEN_AMOUNT
      );
      const sharpenedOriginalSpatial = computeRegionSpatialCorrelation({
        imageData: originalImageData,
        alphaMap: sharpenedAlphaMap,
        region: { x: currentPosition.x, y: currentPosition.y, size: 48 }
      });
      const sharpenedOriginalGradient = computeRegionGradientCorrelation({
        imageData: originalImageData,
        alphaMap: sharpenedAlphaMap,
        region: { x: currentPosition.x, y: currentPosition.y, size: 48 }
      });
      const hasSharpenedStrongEvidence = sharpenedOriginalSpatial >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_SPATIAL && sharpenedOriginalGradient >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_GRADIENT;
      const hasSharpenedWeakEvidence = sharpenedOriginalSpatial >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_SPATIAL && sharpenedOriginalGradient >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_GRADIENT;
      if (hasSharpenedStrongEvidence || hasSharpenedWeakEvidence) {
        const sharpenedCandidate = scoreKnown48AntiTemplateRescueCandidate({
          originalImageData,
          alphaMap: sharpenedAlphaMap,
          position: currentPosition,
          alphaGain: KNOWN_48_ANTI_TEMPLATE_RESCUE_SHARPEN_ALPHA_GAIN,
          baselineGradientScore: currentGradientScore
        });
        if (sharpenedCandidate && (!best || sharpenedCandidate.cost < best.cost)) {
          best = {
            ...sharpenedCandidate,
            originalSpatialScore: sharpenedOriginalSpatial,
            originalGradientScore: sharpenedOriginalGradient,
            suppressionGain: sharpenedOriginalSpatial - sharpenedCandidate.spatialScore
          };
        }
      }
      if (currentSpatialScore <= KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_CURRENT_SPATIAL && currentGradientScore <= KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_CURRENT_GRADIENT) {
        const coreDampenedAlphaMap = scaleKnown48AlphaBand(currentAlphaMap, {
          minAlpha: KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MIN_ALPHA,
          maxAlpha: KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_ALPHA,
          scale: KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_SCALE
        });
        const coreDampenedOriginalSpatial = computeRegionSpatialCorrelation({
          imageData: originalImageData,
          alphaMap: coreDampenedAlphaMap,
          region: { x: currentPosition.x, y: currentPosition.y, size: 48 }
        });
        const coreDampenedOriginalGradient = computeRegionGradientCorrelation({
          imageData: originalImageData,
          alphaMap: coreDampenedAlphaMap,
          region: { x: currentPosition.x, y: currentPosition.y, size: 48 }
        });
        const hasCoreDampenedStrongEvidence = coreDampenedOriginalSpatial >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_SPATIAL && coreDampenedOriginalGradient >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_ORIGINAL_GRADIENT;
        const hasCoreDampenedWeakEvidence = coreDampenedOriginalSpatial >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_SPATIAL && coreDampenedOriginalGradient >= KNOWN_48_ANTI_TEMPLATE_RESCUE_WEAK_MIN_ORIGINAL_GRADIENT;
        if (hasCoreDampenedStrongEvidence || hasCoreDampenedWeakEvidence) {
          const coreDampenedCandidate = scoreKnown48AntiTemplateRescueCandidate({
            originalImageData,
            alphaMap: coreDampenedAlphaMap,
            position: currentPosition,
            alphaGain: KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_ALPHA_GAIN,
            baselineGradientScore: currentGradientScore,
            maxSpatial: KNOWN_48_ANTI_TEMPLATE_RESCUE_CORE_DAMPEN_MAX_SPATIAL
          });
          if (coreDampenedCandidate && (!best || coreDampenedCandidate.cost < best.cost)) {
            best = {
              ...coreDampenedCandidate,
              originalSpatialScore: coreDampenedOriginalSpatial,
              originalGradientScore: coreDampenedOriginalGradient,
              suppressionGain: coreDampenedOriginalSpatial - coreDampenedCandidate.spatialScore
            };
          }
        }
      }
      if (hasMidBoostEntryEvidence && currentSpatialScore <= KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_CURRENT_SPATIAL && currentGradientScore <= KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_CURRENT_GRADIENT) {
        const midBoostBaseAlphaMap = interpolateAlphaMap(
          currentAlphaMap,
          currentPosition.width,
          KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SIZE
        );
        if (midBoostBaseAlphaMap) {
          const midBoostAlphaMap = scaleKnown48AlphaBand(midBoostBaseAlphaMap, {
            minAlpha: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MIN_ALPHA,
            maxAlpha: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_ALPHA,
            scale: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SCALE
          });
          const midBoostPosition = {
            x: originalImageData.width - KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MARGIN - KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SIZE,
            y: originalImageData.height - KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MARGIN - KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SIZE,
            width: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SIZE,
            height: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_SIZE
          };
          if (midBoostPosition.x >= 0 && midBoostPosition.y >= 0 && midBoostPosition.x + midBoostPosition.width <= originalImageData.width && midBoostPosition.y + midBoostPosition.height <= originalImageData.height) {
            const midBoostOriginalSpatial = computeRegionSpatialCorrelation({
              imageData: originalImageData,
              alphaMap: midBoostAlphaMap,
              region: {
                x: midBoostPosition.x,
                y: midBoostPosition.y,
                size: midBoostPosition.width
              }
            });
            const midBoostOriginalGradient = computeRegionGradientCorrelation({
              imageData: originalImageData,
              alphaMap: midBoostAlphaMap,
              region: {
                x: midBoostPosition.x,
                y: midBoostPosition.y,
                size: midBoostPosition.width
              }
            });
            if (midBoostOriginalSpatial >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MIN_ORIGINAL_SPATIAL && midBoostOriginalGradient >= KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MIN_ORIGINAL_GRADIENT) {
              const midBoostCandidate = scoreKnown48AntiTemplateRescueCandidate({
                originalImageData,
                alphaMap: midBoostAlphaMap,
                position: midBoostPosition,
                alphaGain: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_ALPHA_GAIN,
                baselineGradientScore: currentGradientScore,
                maxSpatial: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_SPATIAL,
                maxVisualArtifact: KNOWN_48_ANTI_TEMPLATE_RESCUE_MID_BOOST_MAX_VISUAL_ARTIFACT
              });
              if (midBoostCandidate && (!best || midBoostCandidate.cost < best.cost)) {
                best = {
                  ...midBoostCandidate,
                  originalSpatialScore: midBoostOriginalSpatial,
                  originalGradientScore: midBoostOriginalGradient,
                  suppressionGain: midBoostOriginalSpatial - midBoostCandidate.spatialScore
                };
              }
            }
          }
        }
      }
    }
    if (!best) return null;
    if (best.cost > currentCost - KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_BALANCED_GAIN) return null;
    return best;
  }
  function refineKnown48PowerProfileResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore
  }) {
    if (!isKnown48LargeMarginConfig(currentConfig) || currentPosition?.width !== 48 || currentPosition?.height !== 48 || originalSpatialScore < KNOWN_48_POWER_PROFILE_RESCUE_MIN_ORIGINAL_SPATIAL || originalGradientScore < KNOWN_48_POWER_PROFILE_RESCUE_MIN_ORIGINAL_GRADIENT || currentSpatialScore < KNOWN_48_POWER_PROFILE_RESCUE_MIN_CURRENT_SPATIAL || currentGradientScore > KNOWN_48_POWER_PROFILE_RESCUE_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visible !== true || currentVisibility.visibleSpatialResidual !== true || currentVisibility.visiblePositiveHalo === true) {
      return null;
    }
    const currentCost = scoreLocatedAggressiveCandidate({
      imageData: currentImageData,
      originalImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain,
      baselineGradientScore: currentGradientScore
    }).cost;
    let best = null;
    for (const profile of KNOWN_48_POWER_PROFILE_RESCUE_CANDIDATES) {
      const powerAlphaMap = powerKnown48AlphaMap(currentAlphaMap, profile.exponent);
      const candidate = scoreKnown48AntiTemplateRescueCandidate({
        originalImageData,
        alphaMap: powerAlphaMap,
        position: currentPosition,
        alphaGain: profile.alphaGain,
        baselineGradientScore: currentGradientScore,
        maxSpatial: profile.maxSpatial
      });
      if (!candidate) continue;
      const clearsVisibleSpatialResidual = currentVisibility.visibleSpatialResidual === true && candidate.residualVisibility?.visible === false && Math.abs(currentSpatialScore) - Math.abs(candidate.spatialScore) >= 0.25;
      if (!clearsVisibleSpatialResidual && candidate.cost > currentCost - KNOWN_48_ANTI_TEMPLATE_RESCUE_MIN_BALANCED_GAIN) {
        continue;
      }
      best = {
        ...candidate,
        profileExponent: profile.exponent
      };
      break;
    }
    if (!best) {
      return null;
    }
    return {
      ...best,
      originalSpatialScore,
      originalGradientScore,
      suppressionGain: originalSpatialScore - best.spatialScore
    };
  }
  function refineKnown48PositiveResidualRebalance({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore
  }) {
    if (!currentConfig || currentConfig.logoSize !== 48 || !(Math.abs(Number(currentConfig.marginRight) - 96) <= 2 && Math.abs(Number(currentConfig.marginBottom) - 96) <= 2 || Math.abs(Number(currentConfig.marginRight) - 32) <= 2 && Math.abs(Number(currentConfig.marginBottom) - 32) <= 2) || currentPosition?.width !== 48 || currentPosition?.height !== 48 || originalSpatialScore < KNOWN_48_RESIDUAL_REBALANCE_MIN_ORIGINAL_SPATIAL || originalGradientScore < KNOWN_48_RESIDUAL_REBALANCE_MIN_ORIGINAL_GRADIENT || currentSpatialScore < KNOWN_48_RESIDUAL_REBALANCE_MIN_CURRENT_SPATIAL || currentGradientScore > KNOWN_48_RESIDUAL_REBALANCE_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visibleSpatialResidual !== true) return null;
    const currentPositiveHalo = Math.max(0, currentVisibility?.positiveHaloLum ?? 0);
    let best = null;
    const candidateProfiles = [{
      alphaMap: currentAlphaMap,
      profileExponent: null,
      gains: [
        ...KNOWN_48_RESIDUAL_REBALANCE_GAINS,
        Number((currentAlphaGain + 0.02).toFixed(2)),
        Number((currentAlphaGain + 0.05).toFixed(2)),
        Number((currentAlphaGain + 0.1).toFixed(2))
      ]
    }];
    for (const profile of KNOWN_48_RESIDUAL_REBALANCE_POWER_PROFILES) {
      candidateProfiles.push({
        alphaMap: powerKnown48AlphaMap(currentAlphaMap, profile.exponent),
        profileExponent: profile.exponent,
        gains: profile.gains
      });
    }
    for (const profile of candidateProfiles) {
      const gainCandidates = new Set(profile.gains);
      for (const alphaGain of gainCandidates) {
        if (!Number.isFinite(alphaGain) || alphaGain <= 0) continue;
        const imageData = cloneImageData3(originalImageData);
        removeWatermark(imageData, profile.alphaMap, currentPosition, { alphaGain });
        const spatialScore = computeRegionSpatialCorrelation({
          imageData,
          alphaMap: profile.alphaMap,
          region: {
            x: currentPosition.x,
            y: currentPosition.y,
            size: currentPosition.width
          }
        });
        const gradientScore = computeRegionGradientCorrelation({
          imageData,
          alphaMap: profile.alphaMap,
          region: {
            x: currentPosition.x,
            y: currentPosition.y,
            size: currentPosition.width
          }
        });
        if (spatialScore >= KNOWN_48_RESIDUAL_REBALANCE_MAX_ACCEPTED_SPATIAL || Math.abs(spatialScore) > KNOWN_48_RESIDUAL_REBALANCE_MAX_ACCEPTED_SPATIAL || gradientScore > KNOWN_48_RESIDUAL_REBALANCE_MAX_ACCEPTED_GRADIENT) {
          continue;
        }
        const residualVisibility = assessWatermarkResidualVisibility({
          imageData,
          position: currentPosition,
          alphaMap: profile.alphaMap
        });
        const positiveHaloDrop = currentPositiveHalo - Math.max(0, residualVisibility?.positiveHaloLum ?? 0);
        const lowVisibleHaloAccepted = residualVisibility?.visible === false && Math.max(0, residualVisibility?.positiveHaloLum ?? 0) <= KNOWN_48_RESIDUAL_REBALANCE_MAX_CLEARED_POSITIVE_HALO;
        if (residualVisibility?.visibleSpatialResidual === true || positiveHaloDrop < KNOWN_48_RESIDUAL_REBALANCE_MIN_POSITIVE_HALO_DROP && !lowVisibleHaloAccepted) {
          continue;
        }
        const artifacts = assessRemovalDiffArtifacts({
          originalImageData,
          candidateImageData: imageData,
          alphaMap: profile.alphaMap,
          position: currentPosition,
          alphaGain
        });
        const darkHaloLum = Math.max(0, -(artifacts?.halo?.deltaLum ?? 0));
        const visualArtifactCost = artifacts?.visualArtifactCost ?? Number.POSITIVE_INFINITY;
        const newlyClippedRatio = artifacts?.newlyClippedRatio ?? 0;
        if (darkHaloLum > KNOWN_48_RESIDUAL_REBALANCE_MAX_DARK_HALO || visualArtifactCost > KNOWN_48_RESIDUAL_REBALANCE_MAX_VISUAL_ARTIFACT || newlyClippedRatio > KNOWN_48_RESIDUAL_REBALANCE_MAX_CLIPPED_RATIO) {
          continue;
        }
        const cost = Math.abs(spatialScore) + Math.max(0, gradientScore) * 0.7 + visualArtifactCost * 0.35;
        if (!best || cost < best.cost) {
          best = {
            imageData,
            alphaMap: profile.alphaMap,
            alphaGain,
            profileExponent: profile.profileExponent,
            spatialScore,
            gradientScore,
            residualVisibility,
            artifacts,
            darkHaloLum,
            positiveHaloDrop,
            suppressionGain: originalSpatialScore - spatialScore,
            cost
          };
        }
      }
    }
    return best;
  }
  function applyKnown48BoundaryRepair({
    imageData,
    priorImageData,
    alphaMap,
    position,
    preset = KNOWN_48_BOUNDARY_REPAIR_RESCUE_PRESET
  }) {
    const candidate = cloneImageData3(imageData);
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const alpha = Math.abs(alphaMap[localIndex] ?? 0);
        if (alpha < preset.minAlpha || alpha > preset.maxAlpha) continue;
        const blend = clamp012(Math.pow(alpha, preset.gamma) * preset.strength);
        if (blend <= 5e-3) continue;
        const pixelIndex = ((position.y + row) * candidate.width + position.x + col) * 4;
        for (let channel = 0; channel < 3; channel++) {
          candidate.data[pixelIndex + channel] = clampChannel2(
            imageData.data[pixelIndex + channel] * (1 - blend) + priorImageData.data[pixelIndex + channel] * blend
          );
        }
      }
    }
    return candidate;
  }
  function scoreKnown48BoundaryRepairCandidate({
    originalImageData,
    imageData,
    alphaMap,
    position,
    alphaGain,
    baselineGradientScore
  }) {
    const locatedScore = scoreLocatedAggressiveCandidate({
      imageData,
      originalImageData,
      alphaMap,
      position,
      alphaGain,
      baselineGradientScore
    });
    const residualVisibility = assessWatermarkResidualVisibility({
      imageData,
      position,
      alphaMap
    });
    const calibratedVisibility = assessCalibratedWatermarkResidualVisibility({
      imageData,
      originalImageData,
      position,
      alphaMap,
      alphaGain
    });
    return {
      ...locatedScore,
      residualVisibility,
      calibratedVisibility,
      visualArtifactCost: locatedScore.artifacts?.visualArtifactCost ?? 0
    };
  }
  function refineKnown48BoundaryRepairResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore
  }) {
    if (!isKnown48LargeMarginConfig(currentConfig) || currentPosition?.width !== 48 || currentPosition?.height !== 48 || originalSpatialScore < KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_ORIGINAL_SPATIAL || originalGradientScore < KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_ORIGINAL_GRADIENT || currentSpatialScore < KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_CURRENT_SPATIAL || currentSpatialScore > KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_CURRENT_SPATIAL || currentGradientScore < KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_CURRENT_GRADIENT || currentGradientScore > KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visible !== true) {
      return null;
    }
    const currentNearBlackRatio = calculateNearBlackRatio(currentImageData, currentPosition);
    if (currentNearBlackRatio < KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_NEAR_BLACK_RATIO) {
      return null;
    }
    const beforeScore = scoreKnown48BoundaryRepairCandidate({
      originalImageData,
      imageData: currentImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain,
      baselineGradientScore: currentGradientScore
    });
    const priorImageData = buildPreviewNeighborhoodPrior({
      previewImageData: currentImageData,
      position: currentPosition,
      radius: KNOWN_48_BOUNDARY_REPAIR_RESCUE_PRESET.radius
    });
    const candidateImageData = applyKnown48BoundaryRepair({
      imageData: currentImageData,
      priorImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition
    });
    const afterScore = scoreKnown48BoundaryRepairCandidate({
      originalImageData,
      imageData: candidateImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain,
      baselineGradientScore: currentGradientScore
    });
    const balancedGain = beforeScore.cost - afterScore.cost;
    const artifactDelta = afterScore.visualArtifactCost - beforeScore.visualArtifactCost;
    if (afterScore.residualVisibility?.visible !== false || afterScore.calibratedVisibility?.calibratedVisible !== false || afterScore.spatialScore > KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_SPATIAL || afterScore.gradientScore > KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_GRADIENT || afterScore.visualArtifactCost > KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_ARTIFACT || balancedGain < KNOWN_48_BOUNDARY_REPAIR_RESCUE_MIN_BALANCED_GAIN || artifactDelta > KNOWN_48_BOUNDARY_REPAIR_RESCUE_MAX_ARTIFACT_DELTA) {
      return null;
    }
    return {
      imageData: candidateImageData,
      position: currentPosition,
      config: currentConfig,
      alphaMap: currentAlphaMap,
      alphaGain: currentAlphaGain,
      spatialScore: afterScore.spatialScore,
      gradientScore: afterScore.gradientScore,
      originalSpatialScore,
      originalGradientScore,
      suppressionGain: currentSpatialScore - afterScore.spatialScore,
      balancedGain,
      artifactDelta,
      cost: afterScore.cost
    };
  }
  function refineKnown48SmallMarginPriorRepairResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore,
    source
  }) {
    if (typeof source !== "string" || !source.includes("located-aggressive") || currentConfig?.logoSize !== 48 || Math.abs(Number(currentConfig.marginRight) - 32) > 2 || Math.abs(Number(currentConfig.marginBottom) - 32) > 2 || currentPosition?.width !== 48 || currentPosition?.height !== 48 || originalSpatialScore < KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_ORIGINAL_SPATIAL || originalGradientScore < KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_ORIGINAL_GRADIENT || currentSpatialScore < KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_CURRENT_SPATIAL || currentGradientScore > KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visibleSpatialResidual !== true) return null;
    let best = null;
    const priorByRadius = /* @__PURE__ */ new Map();
    for (const preset of KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_PRESETS) {
      let priorImageData = priorByRadius.get(preset.radius);
      if (!priorImageData) {
        priorImageData = buildPreviewNeighborhoodPrior({
          previewImageData: currentImageData,
          position: currentPosition,
          radius: preset.radius
        });
        priorByRadius.set(preset.radius, priorImageData);
      }
      const candidateImageData = applyKnown48BoundaryRepair({
        imageData: currentImageData,
        priorImageData,
        alphaMap: currentAlphaMap,
        position: currentPosition,
        preset
      });
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidateImageData,
        alphaMap: currentAlphaMap,
        region: {
          x: currentPosition.x,
          y: currentPosition.y,
          size: currentPosition.width
        }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidateImageData,
        alphaMap: currentAlphaMap,
        region: {
          x: currentPosition.x,
          y: currentPosition.y,
          size: currentPosition.width
        }
      });
      const spatialImprovement = Math.abs(currentSpatialScore) - Math.abs(spatialScore);
      if (spatialImprovement < KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MIN_SPATIAL_IMPROVEMENT || spatialScore > KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_SPATIAL || Math.abs(spatialScore) > KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_SPATIAL || gradientScore > KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_GRADIENT) {
        continue;
      }
      const residualVisibility = assessWatermarkResidualVisibility({
        imageData: candidateImageData,
        position: currentPosition,
        alphaMap: currentAlphaMap
      });
      if (residualVisibility?.visible !== false) continue;
      const artifacts = assessRemovalDiffArtifacts({
        originalImageData,
        candidateImageData,
        alphaMap: currentAlphaMap,
        position: currentPosition,
        alphaGain: currentAlphaGain
      });
      const visualArtifactCost = artifacts?.visualArtifactCost ?? Number.POSITIVE_INFINITY;
      const newlyClippedRatio = artifacts?.newlyClippedRatio ?? Number.POSITIVE_INFINITY;
      const darkHaloLum = Math.max(0, -(artifacts?.halo?.deltaLum ?? 0));
      if (visualArtifactCost > KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_ARTIFACT || newlyClippedRatio > KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_CLIPPED || darkHaloLum > KNOWN_48_SMALL_MARGIN_PRIOR_REPAIR_MAX_DARK_HALO) {
        continue;
      }
      const cost = Math.abs(spatialScore) + Math.max(0, gradientScore) * 0.7 + visualArtifactCost * 0.35;
      if (!best || cost < best.cost) {
        best = {
          imageData: candidateImageData,
          alphaMap: currentAlphaMap,
          position: currentPosition,
          config: currentConfig,
          alphaGain: currentAlphaGain,
          spatialScore,
          gradientScore,
          residualVisibility,
          artifacts,
          spatialImprovement,
          suppressionGain: originalSpatialScore - spatialScore,
          preset,
          cost
        };
      }
    }
    return best;
  }
  function refineSmallLocatedPriorRepairResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    originalSpatialScore,
    originalGradientScore,
    source
  }) {
    if (typeof source !== "string" || !source.includes("located-aggressive") || currentPosition?.width !== currentPosition?.height || currentPosition.width < SMALL_LOCATED_PRIOR_REPAIR_MIN_SIZE || currentPosition.width > SMALL_LOCATED_PRIOR_REPAIR_MAX_SIZE || currentConfig?.logoSize !== currentPosition.width || originalSpatialScore < SMALL_LOCATED_PRIOR_REPAIR_MIN_ORIGINAL_SPATIAL || originalGradientScore < SMALL_LOCATED_PRIOR_REPAIR_MIN_ORIGINAL_GRADIENT || currentSpatialScore < SMALL_LOCATED_PRIOR_REPAIR_MIN_CURRENT_SPATIAL || currentGradientScore > SMALL_LOCATED_PRIOR_REPAIR_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visibleSpatialResidual !== true) return null;
    let best = null;
    const priorByRadius = /* @__PURE__ */ new Map();
    for (const preset of SMALL_LOCATED_PRIOR_REPAIR_PRESETS) {
      let priorImageData = priorByRadius.get(preset.radius);
      if (!priorImageData) {
        priorImageData = buildPreviewNeighborhoodPrior({
          previewImageData: currentImageData,
          position: currentPosition,
          radius: preset.radius
        });
        priorByRadius.set(preset.radius, priorImageData);
      }
      const candidateImageData = applyKnown48BoundaryRepair({
        imageData: currentImageData,
        priorImageData,
        alphaMap: currentAlphaMap,
        position: currentPosition,
        preset
      });
      const spatialScore = computeRegionSpatialCorrelation({
        imageData: candidateImageData,
        alphaMap: currentAlphaMap,
        region: {
          x: currentPosition.x,
          y: currentPosition.y,
          size: currentPosition.width
        }
      });
      const gradientScore = computeRegionGradientCorrelation({
        imageData: candidateImageData,
        alphaMap: currentAlphaMap,
        region: {
          x: currentPosition.x,
          y: currentPosition.y,
          size: currentPosition.width
        }
      });
      const spatialImprovement = Math.abs(currentSpatialScore) - Math.abs(spatialScore);
      if (spatialImprovement < SMALL_LOCATED_PRIOR_REPAIR_MIN_SPATIAL_IMPROVEMENT || spatialScore > SMALL_LOCATED_PRIOR_REPAIR_MAX_SPATIAL || Math.abs(spatialScore) > SMALL_LOCATED_PRIOR_REPAIR_MAX_SPATIAL || gradientScore > SMALL_LOCATED_PRIOR_REPAIR_MAX_GRADIENT) {
        continue;
      }
      const residualVisibility = assessWatermarkResidualVisibility({
        imageData: candidateImageData,
        position: currentPosition,
        alphaMap: currentAlphaMap
      });
      if (residualVisibility?.visible !== false) continue;
      const artifacts = assessRemovalDiffArtifacts({
        originalImageData,
        candidateImageData,
        alphaMap: currentAlphaMap,
        position: currentPosition,
        alphaGain: currentAlphaGain
      });
      const visualArtifactCost = artifacts?.visualArtifactCost ?? Number.POSITIVE_INFINITY;
      const newlyClippedRatio = artifacts?.newlyClippedRatio ?? Number.POSITIVE_INFINITY;
      const darkHaloLum = Math.max(0, -(artifacts?.halo?.deltaLum ?? 0));
      if (visualArtifactCost > SMALL_LOCATED_PRIOR_REPAIR_MAX_ARTIFACT || newlyClippedRatio > SMALL_LOCATED_PRIOR_REPAIR_MAX_CLIPPED || darkHaloLum > SMALL_LOCATED_PRIOR_REPAIR_MAX_DARK_HALO) {
        continue;
      }
      const cost = Math.abs(spatialScore) + Math.max(0, gradientScore) * 0.7 + visualArtifactCost * 0.35;
      if (!best || cost < best.cost) {
        best = {
          imageData: candidateImageData,
          alphaMap: currentAlphaMap,
          position: currentPosition,
          config: currentConfig,
          alphaGain: currentAlphaGain,
          spatialScore,
          gradientScore,
          residualVisibility,
          artifacts,
          spatialImprovement,
          suppressionGain: originalSpatialScore - spatialScore,
          preset,
          cost
        };
      }
    }
    return best;
  }
  function measureQuantizedBodyResidualProfile({ imageData, priorImageData, alphaMap, position }) {
    let lowCount = 0;
    let lowAbsResidualSum = 0;
    let bodyCount = 0;
    let bodyResidualSum = 0;
    let bodyNegativeCount = 0;
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const alpha = alphaMap[localIndex] ?? 0;
        const pixelIndex = ((position.y + row) * imageData.width + position.x + col) * 4;
        const residual = (imageData.data[pixelIndex] + imageData.data[pixelIndex + 1] + imageData.data[pixelIndex + 2] - (priorImageData.data[pixelIndex] + priorImageData.data[pixelIndex + 1] + priorImageData.data[pixelIndex + 2])) / 3;
        if (alpha < QUANTIZED_BODY_CORRECTION_LOW_ALPHA_MAX) {
          lowCount++;
          lowAbsResidualSum += Math.abs(residual);
        }
        if (alpha >= QUANTIZED_BODY_CORRECTION_BODY_MIN_ALPHA) {
          bodyCount++;
          bodyResidualSum += residual;
          if (residual < -1) bodyNegativeCount++;
        }
      }
    }
    return {
      lowMeanAbsResidual: lowCount > 0 ? lowAbsResidualSum / lowCount : Number.POSITIVE_INFINITY,
      bodyMeanResidual: bodyCount > 0 ? bodyResidualSum / bodyCount : 0,
      bodyNegativeRatio: bodyCount > 0 ? bodyNegativeCount / bodyCount : 0
    };
  }
  function applyQuantizedBodyCorrection({ imageData, priorImageData, alphaMap, position }) {
    const candidate = cloneImageData3(imageData);
    let changedPixels = 0;
    for (let row = 0; row < position.height; row++) {
      for (let col = 0; col < position.width; col++) {
        const localIndex = row * position.width + col;
        const alpha = alphaMap[localIndex] ?? 0;
        if (alpha < QUANTIZED_BODY_CORRECTION_BODY_MIN_ALPHA) continue;
        const pixelIndex = ((position.y + row) * imageData.width + position.x + col) * 4;
        const residual = (imageData.data[pixelIndex] + imageData.data[pixelIndex + 1] + imageData.data[pixelIndex + 2] - (priorImageData.data[pixelIndex] + priorImageData.data[pixelIndex + 1] + priorImageData.data[pixelIndex + 2])) / 3;
        if (residual >= QUANTIZED_BODY_CORRECTION_RESIDUAL_THRESHOLD) continue;
        for (let channel = 0; channel < 3; channel++) {
          candidate.data[pixelIndex + channel] = clampChannel2(imageData.data[pixelIndex + channel] + 1);
        }
        changedPixels++;
      }
    }
    return {
      imageData: candidate,
      changedPixels
    };
  }
  function scoreQuantizedBodyCorrectionImage({
    originalImageData,
    imageData,
    alphaMap,
    position,
    alphaGain,
    baselineGradientScore
  }) {
    const spatialScore = computeRegionSpatialCorrelation({
      imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const gradientScore = computeRegionGradientCorrelation({
      imageData,
      alphaMap,
      region: { x: position.x, y: position.y, size: position.width }
    });
    const residualVisibility = assessWatermarkResidualVisibility({
      imageData,
      position,
      alphaMap
    });
    const calibratedVisibility = assessCalibratedWatermarkResidualVisibility({
      imageData,
      originalImageData,
      position,
      alphaMap,
      alphaGain
    });
    const nearBlackRatio = calculateNearBlackRatio(imageData, position);
    const baselineNearBlackRatio = calculateNearBlackRatio(originalImageData, position);
    const artifacts = assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: imageData,
      alphaMap,
      position,
      alphaGain
    });
    const darkHaloLum = Math.max(0, -(artifacts?.halo?.deltaLum ?? 0));
    const visualArtifactCost = artifacts?.visualArtifactCost ?? 0;
    const balancedVisual = scoreBalancedVisualCandidate({
      processedSpatial: spatialScore,
      processedGradient: gradientScore,
      nearBlackIncrease: nearBlackRatio - baselineNearBlackRatio,
      newlyClippedRatio: artifacts?.newlyClippedRatio,
      darkHaloLum,
      visualArtifactCost,
      gradientIncrease: Number.isFinite(baselineGradientScore) ? gradientScore - baselineGradientScore : 0
    });
    return {
      spatialScore,
      gradientScore,
      residualVisibility,
      calibratedVisibility,
      artifacts,
      darkHaloLum,
      visualArtifactCost,
      balancedVisual
    };
  }
  function refineQuantizedNegativeBodyResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain
  }) {
    if (currentPosition?.width !== QUANTIZED_BODY_CORRECTION_SIZE || currentPosition?.height !== QUANTIZED_BODY_CORRECTION_SIZE || currentConfig?.logoSize !== QUANTIZED_BODY_CORRECTION_SIZE || currentConfig?.marginRight !== QUANTIZED_BODY_CORRECTION_MARGIN || currentConfig?.marginBottom !== QUANTIZED_BODY_CORRECTION_MARGIN || currentSpatialScore > QUANTIZED_BODY_CORRECTION_MAX_CURRENT_SPATIAL || currentGradientScore >= QUANTIZED_BODY_CORRECTION_MAX_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visible !== true) return null;
    const priorImageData = buildPreviewNeighborhoodPrior({
      previewImageData: currentImageData,
      position: currentPosition,
      radius: QUANTIZED_BODY_CORRECTION_PRIOR_RADIUS
    });
    const profile = measureQuantizedBodyResidualProfile({
      imageData: currentImageData,
      priorImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition
    });
    if (profile.lowMeanAbsResidual > QUANTIZED_BODY_CORRECTION_LOW_ABS_MAX || profile.bodyMeanResidual > QUANTIZED_BODY_CORRECTION_BODY_MEAN_MAX || profile.bodyNegativeRatio < QUANTIZED_BODY_CORRECTION_BODY_NEGATIVE_RATIO_MIN) {
      return null;
    }
    const beforeScore = scoreQuantizedBodyCorrectionImage({
      originalImageData,
      imageData: currentImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain,
      baselineGradientScore: currentGradientScore
    });
    const correction = applyQuantizedBodyCorrection({
      imageData: currentImageData,
      priorImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition
    });
    if (correction.changedPixels <= 0) return null;
    const afterScore = scoreQuantizedBodyCorrectionImage({
      originalImageData,
      imageData: correction.imageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain,
      baselineGradientScore: currentGradientScore
    });
    const balancedGain = beforeScore.balancedVisual.score - afterScore.balancedVisual.score;
    const artifactDelta = afterScore.visualArtifactCost - beforeScore.visualArtifactCost;
    const clearsVisible = afterScore.calibratedVisibility?.calibratedVisible === false && afterScore.residualVisibility?.visible === false;
    if (!clearsVisible || balancedGain < QUANTIZED_BODY_CORRECTION_MIN_BALANCED_GAIN || artifactDelta > QUANTIZED_BODY_CORRECTION_MAX_ARTIFACT_INCREASE) {
      return null;
    }
    return {
      imageData: correction.imageData,
      changedPixels: correction.changedPixels,
      profile,
      spatialScore: afterScore.spatialScore,
      gradientScore: afterScore.gradientScore,
      suppressionGain: currentSpatialScore - afterScore.spatialScore,
      balancedGain,
      artifactDelta,
      cost: afterScore.balancedVisual.score,
      alphaGain: currentAlphaGain
    };
  }
  function resolveRescueAlphaMaps({ size, currentAlphaMap, currentSize, alpha96, getAlphaMap }) {
    const alphaMaps = [];
    const addAlphaMap = (alphaMap, source) => {
      if (!alphaMap || alphaMaps.some((entry) => entry.alphaMap === alphaMap)) return;
      alphaMaps.push({ alphaMap, source });
    };
    if (typeof getAlphaMap === "function") {
      addAlphaMap(getAlphaMap(size), "provided");
    }
    if (size === currentSize) {
      addAlphaMap(currentAlphaMap, "current");
    } else {
      addAlphaMap(interpolateAlphaMap(currentAlphaMap, currentSize, size), "current-interpolated");
    }
    if (alpha96 && size !== 96) {
      addAlphaMap(interpolateAlphaMap(alpha96, 96, size), "alpha96-interpolated");
    }
    return alphaMaps;
  }
  function refineDarkHaloResidual({
    originalImageData,
    currentImageData,
    currentAlphaMap,
    currentPosition,
    currentConfig,
    currentSpatialScore,
    currentGradientScore,
    currentAlphaGain,
    alpha96,
    getAlphaMap
  }) {
    if (!isKnown48LargeMarginConfig(currentConfig) || !currentPosition || currentPosition.width !== currentPosition.height || currentSpatialScore > DARK_HALO_RESCUE_MAX_CURRENT_SPATIAL || Math.abs(currentGradientScore) > DARK_HALO_RESCUE_MAX_ABS_CURRENT_GRADIENT) {
      return null;
    }
    const currentVisibility = assessWatermarkResidualVisibility({
      imageData: currentImageData,
      position: currentPosition,
      alphaMap: currentAlphaMap
    });
    if (currentVisibility?.visible !== true || currentVisibility.visiblePositiveHalo === true) {
      return null;
    }
    const currentArtifacts = assessRemovalDiffArtifacts({
      originalImageData,
      candidateImageData: currentImageData,
      alphaMap: currentAlphaMap,
      position: currentPosition,
      alphaGain: currentAlphaGain
    });
    const currentDarkHaloLum = Math.max(0, -(currentArtifacts?.halo?.deltaLum ?? 0));
    if (currentDarkHaloLum < DARK_HALO_RESCUE_MIN_DARK_HALO_LUM) return null;
    const currentScore = scoreBalancedVisualCandidate({
      processedSpatial: currentSpatialScore,
      processedGradient: currentGradientScore,
      newlyClippedRatio: currentArtifacts?.newlyClippedRatio,
      darkHaloLum: currentDarkHaloLum,
      visualArtifactCost: currentArtifacts?.visualArtifactCost
    }).score;
    let best = null;
    for (const config of DARK_HALO_RESCUE_CONFIGS) {
      const size = config.logoSize;
      const alphaMaps = resolveRescueAlphaMaps({
        size,
        currentAlphaMap,
        currentSize: currentPosition.width,
        alpha96,
        getAlphaMap
      });
      if (alphaMaps.length === 0) continue;
      const position = {
        x: originalImageData.width - config.marginRight - size,
        y: originalImageData.height - config.marginBottom - size,
        width: size,
        height: size
      };
      if (position.x < 0 || position.y < 0 || position.x + position.width > originalImageData.width || position.y + position.height > originalImageData.height) {
        continue;
      }
      for (const alphaEntry of alphaMaps) {
        const { alphaMap } = alphaEntry;
        const originalSpatial = computeRegionSpatialCorrelation({
          imageData: originalImageData,
          alphaMap,
          region: { x: position.x, y: position.y, size }
        });
        const originalGradient = computeRegionGradientCorrelation({
          imageData: originalImageData,
          alphaMap,
          region: { x: position.x, y: position.y, size }
        });
        for (const alphaGain of DARK_HALO_RESCUE_GAINS) {
          for (const logoValue of DARK_HALO_RESCUE_LOGO_VALUES) {
            const candidate = scoreKnown48AntiTemplateRescueCandidate({
              originalImageData,
              alphaMap,
              position,
              alphaGain,
              logoValue,
              baselineGradientScore: currentGradientScore,
              maxSpatial: 0.18,
              maxVisualArtifact: DARK_HALO_RESCUE_MAX_VISUAL_ARTIFACT
            });
            if (!candidate) continue;
            const darkHaloLum = Math.max(0, -(candidate.artifacts?.halo?.deltaLum ?? 0));
            const newlyClippedRatio = candidate.artifacts?.newlyClippedRatio ?? 0;
            if (darkHaloLum > DARK_HALO_RESCUE_MAX_DARK_HALO_LUM || newlyClippedRatio > DARK_HALO_RESCUE_MAX_NEWLY_CLIPPED_RATIO) {
              continue;
            }
            if (!best || candidate.cost < best.cost) {
              best = {
                ...candidate,
                alphaMapSource: alphaEntry.source,
                originalSpatialScore: originalSpatial,
                originalGradientScore: originalGradient,
                suppressionGain: originalSpatial - candidate.spatialScore
              };
            }
          }
        }
      }
    }
    if (!best) return null;
    if (best.cost > currentScore - DARK_HALO_RESCUE_MIN_BALANCED_GAIN) return null;
    return best;
  }
  function createAcceptedPipelineMetrics() {
    return {
      calculateNearBlackRatio,
      computeRegionGradientCorrelation,
      createRegionCorrelationMetrics,
      measureOuterBorderLuminanceStd,
      assessWatermarkResidualVisibility
    };
  }
  function createAcceptedPipelineGates() {
    return {
      shouldRecalibrateAlphaStrength,
      shouldApplyPreviewSmoothBackgroundCleanup,
      shouldSkipLocatedAggressiveForCleanCanonical96
    };
  }
  function createAcceptedPipelineExecutorConfig() {
    return {
      maxNearBlackRatioIncrease: MAX_NEAR_BLACK_RATIO_INCREASE3,
      outlineConfig: {
        outlineRefinementThreshold: OUTLINE_REFINEMENT_THRESHOLD,
        outlineRefinementMinGain: OUTLINE_REFINEMENT_MIN_GAIN,
        subpixelRefineShifts: SUBPIXEL_REFINE_SHIFTS,
        subpixelRefineScales: SUBPIXEL_REFINE_SCALES,
        minGradientImprovement: 0.04,
        maxSpatialDrift: 0.08
      },
      repairCleanupConfig: {
        previewEdgeCleanupMaxAppliedPasses: PREVIEW_EDGE_CLEANUP_MAX_APPLIED_PASSES,
        previewEdgeCleanupMinGradientImprovement: PREVIEW_EDGE_CLEANUP_MIN_GRADIENT_IMPROVEMENT,
        previewEdgeCleanupMaxSpatialDrift: PREVIEW_EDGE_CLEANUP_MAX_SPATIAL_DRIFT,
        known48EdgeCleanupMinGradientImprovement: KNOWN_48_EDGE_CLEANUP_MIN_GRADIENT_IMPROVEMENT,
        known48EdgeCleanupMaxSpatialDrift: KNOWN_48_EDGE_CLEANUP_MAX_SPATIAL_DRIFT,
        v2SmallEdgeCleanupMinGradientImprovement: V2_SMALL_EDGE_CLEANUP_MIN_GRADIENT_IMPROVEMENT,
        v2SmallEdgeCleanupMaxSpatialDrift: V2_SMALL_EDGE_CLEANUP_MAX_SPATIAL_DRIFT,
        known48FlatFillMaxAppliedPasses: KNOWN_48_FLAT_FILL_MAX_APPLIED_PASSES,
        known48FlatFillMinGradientImprovement: KNOWN_48_FLAT_FILL_MIN_GRADIENT_IMPROVEMENT,
        known48FlatFillSecondPassMinGradientImprovement: KNOWN_48_FLAT_FILL_SECOND_PASS_MIN_GRADIENT_IMPROVEMENT
      }
    };
  }
  function createAcceptedPipelineRefiners() {
    return {
      recalibrateAlphaStrength,
      recalibrateOverSubtractedAlpha,
      fineTuneDarkCatalogAlpha,
      fineTuneWeakPositiveResidualAlpha,
      applyPreviewSmoothBackgroundCleanup,
      refineSubpixelOutline,
      refinePreviewResidualEdge,
      refineKnown48FlatBackgroundResidual,
      refineKnown48LumaEdgeResidual,
      refineNewMargin96FlatBackgroundResidual,
      refineSmallPreviewAnchorCandidate,
      refineSmallFixedLocalAnchorGeometry,
      refineLocatedAggressiveRemoval,
      refineCanonical96PositiveHaloResidual,
      refineSmoothLocatedResidualWithEstimatedPrior,
      refineNewMargin96VariantResidual,
      refineKnown48AntiTemplateResidual,
      refineKnown48PowerProfileResidual,
      refineKnown48PositiveResidualRebalance,
      refineKnown48SmallMarginPriorRepairResidual,
      refineSmallLocatedPriorRepairResidual,
      refineKnown48BoundaryRepairResidual,
      refineDarkHaloResidual,
      refineQuantizedNegativeBodyResidual,
      refineKnown48MidCoreBiasResidual
    };
  }
  function createAcceptedPipelineDependencies() {
    return {
      metrics: createAcceptedPipelineMetrics(),
      gates: createAcceptedPipelineGates(),
      config: createAcceptedPipelineExecutorConfig(),
      refiners: createAcceptedPipelineRefiners()
    };
  }
  function processWatermarkImageData(imageData, options = {}) {
    return runImageWatermarkPipeline(createImageWatermarkPipelineRequest({
      imageData,
      options,
      nowMs,
      cloneImageData: cloneImageData3,
      alphaGainCandidates: ALPHA_GAIN_CANDIDATES,
      alphaPriorityGains: STANDARD_ALPHA_PRIORITY_GAINS,
      createAcceptedPipelineDependencies,
      cleanupConfig: createImageWatermarkPipelineCleanupConfig({
        previewEdgeCleanupMaxSize: PREVIEW_EDGE_CLEANUP_MAX_SIZE,
        known48EdgeCleanupMinSize: KNOWN_48_EDGE_CLEANUP_MIN_SIZE,
        known48EdgeCleanupMaxSize: KNOWN_48_EDGE_CLEANUP_MAX_SIZE,
        v2SmallEdgeCleanupSize: V2_SMALL_EDGE_CLEANUP_SIZE,
        v2SmallEdgeCleanupSizeTolerance: V2_SMALL_EDGE_CLEANUP_SIZE_TOLERANCE
      }),
      visualPostProcessingEnabled: ENABLE_VISUAL_POST_PROCESSING
    }));
  }

  // src/core/watermarkEngine.js
  function createRuntimeCanvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(width, height);
    }
    if (typeof document !== "undefined") {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    throw new Error("Canvas runtime not available");
  }
  function getCanvasContext2D(canvas) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      throw new Error("Failed to get 2D canvas context");
    }
    return ctx;
  }
  var WatermarkEngine = class _WatermarkEngine {
    constructor() {
      this.alphaMaps = {};
    }
    static async create() {
      return new _WatermarkEngine();
    }
    /**
     * Get alpha map from background captured image based on watermark size
     * @param {number} size - Watermark size (48 or 96)
     * @returns {Promise<Float32Array>} Alpha map
     */
    async getAlphaMap(size) {
      if (size === "96-20260520" || size === "36-v2") {
        if (this.alphaMaps[size]) return this.alphaMaps[size];
        const alphaMap2 = getEmbeddedAlphaMap(size);
        if (!alphaMap2) {
          throw new Error(`Missing embedded alpha map for size ${size}`);
        }
        this.alphaMaps[size] = alphaMap2;
        return alphaMap2;
      }
      if (size !== 48 && size !== 96) {
        if (this.alphaMaps[size]) return this.alphaMaps[size];
        const alpha96 = await this.getAlphaMap(96);
        const interpolated = interpolateAlphaMap(alpha96, 96, size);
        this.alphaMaps[size] = interpolated;
        return interpolated;
      }
      if (this.alphaMaps[size]) {
        return this.alphaMaps[size];
      }
      const alphaMap = getEmbeddedAlphaMap(size);
      if (!alphaMap) {
        throw new Error(`Missing embedded alpha map for size ${size}`);
      }
      this.alphaMaps[size] = alphaMap;
      return alphaMap;
    }
    /**
     * Remove watermark from image based on watermark size
     * @param {HTMLImageElement|HTMLCanvasElement} image - Input image
     * @returns {Promise<HTMLCanvasElement>} Processed canvas
     */
    async removeWatermarkFromImage(image, options = {}) {
      const now = () => {
        if (typeof globalThis.performance?.now === "function") {
          return globalThis.performance.now();
        }
        return Date.now();
      };
      const canvas = createRuntimeCanvas(image.width, image.height);
      const ctx = getCanvasContext2D(canvas);
      const drawStartedAt = now();
      ctx.drawImage(image, 0, 0);
      const drawMs = now() - drawStartedAt;
      const readStartedAt = now();
      const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const getImageDataMs = now() - readStartedAt;
      const alpha48 = await this.getAlphaMap(48);
      const alpha96 = await this.getAlphaMap(96);
      const alpha96NewMargin = await this.getAlphaMap("96-20260520");
      await this.getAlphaMap("36-v2");
      const processingStartedAt = now();
      const result = processWatermarkImageData(originalImageData, {
        alpha48,
        alpha96,
        alpha96Variants: {
          "20260520": alpha96NewMargin
        },
        adaptiveMode: options.adaptiveMode,
        debugTimings: options.debugTimings === true,
        getAlphaMap: (size) => this.alphaMaps[size] || interpolateAlphaMap(alpha96, 96, size)
      });
      const processWatermarkImageDataMs = now() - processingStartedAt;
      const writeStartedAt = now();
      ctx.putImageData(result.imageData, 0, 0);
      const putImageDataMs = now() - writeStartedAt;
      canvas.__watermarkMeta = result.meta;
      canvas.__watermarkTiming = {
        drawMs,
        getImageDataMs,
        processWatermarkImageDataMs,
        putImageDataMs,
        processor: result.debugTimings ?? null
      };
      return canvas;
    }
    /**
     * Get watermark information (for display)
     * @param {number} imageWidth - Image width
     * @param {number} imageHeight - Image height
     * @returns {Object} Watermark information {size, position, config}
     */
    getWatermarkInfo(imageWidth, imageHeight) {
      const config = detectWatermarkConfig(imageWidth, imageHeight);
      const position = calculateWatermarkPosition(imageWidth, imageHeight, config);
      return {
        size: config.logoSize,
        position,
        config
      };
    }
  };

  // src/sdk/image-data.js
  async function createWatermarkEngine() {
    return WatermarkEngine.create();
  }
  function buildEmbeddedGetAlphaMap(alpha48, alpha96) {
    return (size) => {
      if (size === 48) return alpha48;
      if (size === 96) return alpha96;
      return interpolateAlphaMap(alpha96, 96, size);
    };
  }
  function removeWatermarkFromImageDataSync(imageData, options = {}) {
    const alpha48 = options.alpha48 || getEmbeddedAlphaMap(48);
    const alpha96 = options.alpha96 || getEmbeddedAlphaMap(96);
    const alpha96Variants = options.alpha96Variants || {
      "20260520": getEmbeddedAlphaMap("96-20260520")
    };
    return processWatermarkImageData(imageData, {
      ...options,
      alpha48,
      alpha96,
      alpha96Variants,
      getAlphaMap: options.getAlphaMap || buildEmbeddedGetAlphaMap(alpha48, alpha96)
    });
  }
  async function removeWatermarkFromImageData(imageData, options = {}) {
    const engine = options.engine instanceof WatermarkEngine ? options.engine : await createWatermarkEngine();
    const alpha48 = await engine.getAlphaMap(48);
    const alpha96 = await engine.getAlphaMap(96);
    const alpha96Variants = options.alpha96Variants || {
      "20260520": await engine.getAlphaMap("96-20260520")
    };
    return processWatermarkImageData(imageData, {
      ...options,
      alpha48,
      alpha96,
      alpha96Variants,
      getAlphaMap: options.getAlphaMap || buildEmbeddedGetAlphaMap(alpha48, alpha96)
    });
  }
  return __toCommonJS(image_data_exports);
})();
