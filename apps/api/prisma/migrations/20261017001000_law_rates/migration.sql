-- The rates set by law, by year (owner's request, 16 October 2026: "creating a setup page for payroll to enter the
-- variables that might affect the sheet"; the tax brackets "editable by superadmin, to modify it if the law changed"):
-- the social insurance shares, the insurable wage limits, the personal exemption, the Martyrs' Fund, comprehensive
-- health insurance and the salary tax's tiers, until now constants in packages/shared (salary.ts, contracts.ts). The
-- Super Admin changes them on Organization → Payroll; HR, Finance, the CEO and Admin read them.

-- 1. A row per year, applying from that year: a year without its own uses the latest earlier one (the earliest for a
-- year before them all). Rates as fractions (0.11 for 11%), amounts in EGP; the tax tiers as packages/shared's TaxTier[]
-- ([{ upTo, bands: [{ upTo, rate }] }], upTo null for no limit), checked by the API (taxTiersProblems).
CREATE TABLE "payroll_law_years" (
    "year" INTEGER NOT NULL,
    "employee_insurance_rate" DECIMAL(8,6) NOT NULL,
    "employer_insurance_rate" DECIMAL(8,6) NOT NULL,
    "insurable_wage_min" DECIMAL(12,2) NOT NULL,
    "insurable_wage_max" DECIMAL(12,2) NOT NULL,
    "personal_exemption" DECIMAL(12,2) NOT NULL,
    "martyrs_rate" DECIMAL(8,6) NOT NULL,
    "health_insurance_rate" DECIMAL(8,6) NOT NULL,
    "tax_tiers" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" UUID,

    CONSTRAINT "payroll_law_years_pkey" PRIMARY KEY ("year"),
    CONSTRAINT "payroll_law_years_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
    CONSTRAINT "payroll_law_years_rates_check" CHECK (
        "employee_insurance_rate" BETWEEN 0 AND 1 AND "employer_insurance_rate" BETWEEN 0 AND 1
        AND "martyrs_rate" BETWEEN 0 AND 1 AND "health_insurance_rate" BETWEEN 0 AND 1
    ),
    CONSTRAINT "payroll_law_years_insurable_wage_check" CHECK ("insurable_wage_min" > 0 AND "insurable_wage_max" >= "insurable_wage_min"),
    CONSTRAINT "payroll_law_years_personal_exemption_check" CHECK ("personal_exemption" >= 0),
    CONSTRAINT "payroll_law_years_tax_tiers_check" CHECK (
        CASE WHEN jsonb_typeof("tax_tiers") = 'array' THEN jsonb_array_length("tax_tiers") > 0 ELSE false END
    )
);
ALTER TABLE "payroll_law_years" ADD CONSTRAINT "payroll_law_years_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. 2025 and 2026 exactly as the constants were (packages/shared law-rates.ts BUILT_IN_LAW_RATES), so no figure
-- changes: Law 7/2024's tiers, the employee's 11% and the company's 18.75% of the insured wage (Law 148/2019), the
-- EGP 20,000 personal exemption, the Martyrs' Fund's 0.05% (Law 4/2021), no health insurance while it doesn't apply in
-- Cairo (Law 2/2018), and NOSI's insurable wage limits: 2,300 to 14,500 in 2025, 2,700 to 16,700 in 2026.
INSERT INTO "payroll_law_years" (
    "year", "employee_insurance_rate", "employer_insurance_rate", "insurable_wage_min", "insurable_wage_max",
    "personal_exemption", "martyrs_rate", "health_insurance_rate", "tax_tiers", "updated_at"
)
SELECT y.year, 0.11, 0.1875, y.min, y.max, 20000, 0.0005, 0, '[
    {"upTo": 600000, "bands": [{"upTo": 40000, "rate": 0}, {"upTo": 55000, "rate": 0.1}, {"upTo": 70000, "rate": 0.15}, {"upTo": 200000, "rate": 0.2}, {"upTo": 400000, "rate": 0.225}, {"upTo": null, "rate": 0.25}]},
    {"upTo": 700000, "bands": [{"upTo": 55000, "rate": 0.1}, {"upTo": 70000, "rate": 0.15}, {"upTo": 200000, "rate": 0.2}, {"upTo": 400000, "rate": 0.225}, {"upTo": null, "rate": 0.25}]},
    {"upTo": 800000, "bands": [{"upTo": 70000, "rate": 0.15}, {"upTo": 200000, "rate": 0.2}, {"upTo": 400000, "rate": 0.225}, {"upTo": null, "rate": 0.25}]},
    {"upTo": 900000, "bands": [{"upTo": 200000, "rate": 0.2}, {"upTo": 400000, "rate": 0.225}, {"upTo": null, "rate": 0.25}]},
    {"upTo": 1200000, "bands": [{"upTo": 400000, "rate": 0.225}, {"upTo": null, "rate": 0.25}]},
    {"upTo": null, "bands": [{"upTo": 1200000, "rate": 0.25}, {"upTo": null, "rate": 0.275}]}
]'::jsonb, CURRENT_TIMESTAMP
FROM (VALUES (2025, 2300, 14500), (2026, 2700, 16700)) AS y(year, min, max);

-- 3. A payroll run keeps a copy of the year's rates it was worked out with, taken when it is made and when it is
-- refreshed, so an approved or paid run never changes. Runs made before now have none: they were worked out with the
-- built-in rates, the same as the rows above, which the API uses for them.
ALTER TABLE "payroll_runs" ADD COLUMN "law_rates" JSONB;
