const SAMPLE_FILE_NAME = "sample-sales-data.csv";
const SAMPLE_MONTH_COUNT = 30;
const SAMPLE_SEED = 20240115;
const SAMPLE_BASE_ORDERS = 150;
const SAMPLE_MONTHLY_GROWTH = 0.012;
const SAMPLE_SEASONAL_AMPLITUDE = 0.35;
const SAMPLE_VOLUME_JITTER = 0.1;
const SAMPLE_BASE_CUSTOMERS = 60;
const SAMPLE_NEW_CUSTOMERS_PER_MONTH = 24;

const SAMPLE_COLUMNS = ["Order Date", "Customer ID", "Region", "Product Category", "Sales Channel", "Revenue", "Units"];

const SAMPLE_REGIONS = ["North America", "EMEA", "APAC", "Latin America"];
const SAMPLE_REGION_WEIGHTS = [0.42, 0.28, 0.19, 0.11];

const SAMPLE_CATEGORIES = ["Software Licenses", "Hardware", "Professional Services", "Training", "Support Contracts"];
const SAMPLE_CATEGORY_WEIGHTS = [0.34, 0.21, 0.22, 0.09, 0.14];
const SAMPLE_CATEGORY_PRICES = [4200, 6800, 9500, 2100, 3400];

const SAMPLE_CHANNELS = ["Direct Sales", "Partner", "Online"];
const SAMPLE_CHANNEL_WEIGHTS = [0.47, 0.31, 0.22];

const SAMPLE_SEASONALITY = [0.86, 0.84, 1.03, 0.95, 0.98, 1.09, 0.9, 0.88, 1.06, 1.12, 1.27, 1.38];

function sampleRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function samplePickWeighted(weights, r) {
  let acc = 0;
  for (let i = 0; i < weights.length; i++) {
    acc += weights[i];
    if (r <= acc) return i;
  }
  return weights.length - 1;
}

function buildSampleCSV() {
  const rand = sampleRandom(SAMPLE_SEED);
  const now = new Date();
  const endOrd = now.getUTCFullYear() * 12 + now.getUTCMonth() - 1;
  const startOrd = endOrd - (SAMPLE_MONTH_COUNT - 1);
  const lines = [SAMPLE_COLUMNS.join(",")];

  for (let i = 0; i < SAMPLE_MONTH_COUNT; i++) {
    const ord = startOrd + i;
    const year = Math.floor(ord / 12);
    const month = (ord % 12) + 1;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const trend = 1 + SAMPLE_MONTHLY_GROWTH * i;
    const seasonal = 1 + (SAMPLE_SEASONALITY[month - 1] - 1) * SAMPLE_SEASONAL_AMPLITUDE;
    const jitter = 1 - SAMPLE_VOLUME_JITTER / 2 + SAMPLE_VOLUME_JITTER * rand();
    const orderCount = Math.round(SAMPLE_BASE_ORDERS * trend * seasonal * jitter);
    const customerPool = SAMPLE_BASE_CUSTOMERS + Math.round(i * SAMPLE_NEW_CUSTOMERS_PER_MONTH);

    for (let j = 0; j < orderCount; j++) {
      const day = 1 + Math.floor(rand() * daysInMonth);
      const customerNumber = 1 + Math.floor(rand() * customerPool);
      const region = SAMPLE_REGIONS[samplePickWeighted(SAMPLE_REGION_WEIGHTS, rand())];
      const categoryIdx = samplePickWeighted(SAMPLE_CATEGORY_WEIGHTS, rand());
      const channel = SAMPLE_CHANNELS[samplePickWeighted(SAMPLE_CHANNEL_WEIGHTS, rand())];
      const units = 1 + Math.floor(rand() * 9);
      const unitPrice = SAMPLE_CATEGORY_PRICES[categoryIdx] * (0.88 + 0.24 * rand());

      lines.push([
        `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        `CUST${String(customerNumber).padStart(4, "0")}`,
        region,
        SAMPLE_CATEGORIES[categoryIdx],
        channel,
        (units * unitPrice).toFixed(2),
        units
      ].join(","));
    }
  }

  return lines.join("\n");
}

function buildSampleDataFile() {
  return new File([buildSampleCSV()], SAMPLE_FILE_NAME, { type: "text/csv" });
}
