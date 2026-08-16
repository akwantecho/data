-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('ORGANIZATION_ADMIN', 'ANALYST', 'VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DataSourceType" AS ENUM ('MANUAL', 'CSV');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "DatasetColumnType" AS ENUM ('STRING', 'NUMBER', 'DATE', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'MAPPED', 'VALIDATED', 'COMMITTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'WARNING', 'REJECTED');

-- CreateEnum
CREATE TYPE "ValidationSeverity" AS ENUM ('WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "MetricUnit" AS ENUM ('CURRENCY', 'PERCENTAGE', 'COUNT', 'DECIMAL', 'RATIO', 'DAYS', 'HOURS', 'MINUTES', 'SCORE');

-- CreateEnum
CREATE TYPE "MetricFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "MetricDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'TARGET_RANGE', 'INFORMATIONAL');

-- CreateEnum
CREATE TYPE "AggregationType" AS ENUM ('SUM', 'AVERAGE', 'LAST', 'MIN', 'MAX', 'FORMULA');

-- CreateEnum
CREATE TYPE "PeriodType" AS ENUM ('DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlertRuleType" AS ENUM ('METRIC_BELOW_THRESHOLD', 'METRIC_ABOVE_THRESHOLD', 'LARGE_PERIOD_CHANGE', 'TARGET_MISSED', 'DATA_SOURCE_STALE', 'DATA_QUALITY_DEGRADED');

-- CreateEnum
CREATE TYPE "GoalStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ON_TRACK', 'AT_RISK', 'OFF_TRACK', 'ACHIEVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('DRAFT', 'OPEN', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DecisionPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DecisionReviewResult" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE', 'INCONCLUSIVE');

-- CreateEnum
CREATE TYPE "AiMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "platformRole" "PlatformRole",
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_users" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industries" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "industryId" UUID,
    "countryCode" VARCHAR(2) NOT NULL,
    "currencyCode" VARCHAR(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "countryCode" VARCHAR(2),
    "timezone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "branchId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "datasets" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dataSourceId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "datasets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dataset_columns" (
    "id" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DatasetColumnType" NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "unit" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_imports" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dataSourceId" UUID,
    "datasetId" UUID,
    "createdById" UUID,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "mapping" JSONB,
    "rowsReceived" INTEGER NOT NULL DEFAULT 0,
    "rowsValid" INTEGER NOT NULL DEFAULT 0,
    "rowsWarning" INTEGER NOT NULL DEFAULT 0,
    "rowsRejected" INTEGER NOT NULL DEFAULT 0,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_import_rows" (
    "id" UUID NOT NULL,
    "dataImportId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "parsedData" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'VALID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_validation_errors" (
    "id" UUID NOT NULL,
    "dataImportId" UUID NOT NULL,
    "rowId" UUID,
    "rowNumber" INTEGER,
    "column" TEXT,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "ValidationSeverity" NOT NULL DEFAULT 'ERROR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_validation_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metrics" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "industryId" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "unit" "MetricUnit" NOT NULL,
    "aggregationType" "AggregationType" NOT NULL,
    "frequency" "MetricFrequency" NOT NULL DEFAULT 'MONTHLY',
    "direction" "MetricDirection" NOT NULL DEFAULT 'HIGHER_IS_BETTER',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_formulas" (
    "id" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "expression" TEXT NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_formulas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_dependencies" (
    "id" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "dependsOnId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "metric_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_values" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "branchId" UUID,
    "departmentId" UUID,
    "periodType" "PeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "value" DECIMAL(20,6) NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceRef" TEXT,
    "isCalculated" BOOLEAN NOT NULL DEFAULT false,
    "calculatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_targets" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "branchId" UUID,
    "periodType" "PeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "targetValue" DECIMAL(20,6) NOT NULL,
    "minValue" DECIMAL(20,6),
    "maxValue" DECIMAL(20,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_thresholds" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "warningValue" DECIMAL(20,6),
    "criticalValue" DECIMAL(20,6),
    "isRelativeToTarget" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_packs" (
    "id" UUID NOT NULL,
    "industryId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industry_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_pack_metrics" (
    "id" UUID NOT NULL,
    "industryPackId" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "industry_pack_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_pack_health_models" (
    "id" UUID NOT NULL,
    "industryPackId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_pack_health_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_pack_insight_rules" (
    "id" UUID NOT NULL,
    "industryPackId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "industry_pack_insight_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_industry_packs" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "industryPackId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_industry_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_models" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "bands" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_categories" (
    "id" UUID NOT NULL,
    "healthModelId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_metric_weights" (
    "id" UUID NOT NULL,
    "healthCategoryId" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "weight" DECIMAL(6,3) NOT NULL,

    CONSTRAINT "health_metric_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_scores" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "healthModelId" UUID NOT NULL,
    "branchId" UUID,
    "periodType" "PeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "overallScore" DECIMAL(6,3) NOT NULL,
    "band" TEXT NOT NULL,
    "breakdown" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "metricId" UUID,
    "name" TEXT NOT NULL,
    "type" "AlertRuleType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "alertRuleId" UUID,
    "metricId" UUID,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "periodType" "PeriodType",
    "periodStart" DATE,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" UUID NOT NULL,
    "alertId" UUID NOT NULL,
    "actorId" UUID,
    "fromStatus" "AlertStatus",
    "toStatus" "AlertStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_rules" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "definition" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insight_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insights" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "insightRuleId" UUID,
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL,
    "category" TEXT,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
    "periodType" "PeriodType",
    "periodStart" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insight_evidence" (
    "id" UUID NOT NULL,
    "insightId" UUID NOT NULL,
    "metricId" UUID,
    "label" TEXT NOT NULL,
    "value" DECIMAL(20,6),
    "changePct" DECIMAL(12,4),
    "detail" JSONB,

    CONSTRAINT "insight_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goals" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" UUID,
    "baselineValue" DECIMAL(20,6),
    "targetValue" DECIMAL(20,6) NOT NULL,
    "currentValue" DECIMAL(20,6),
    "progressPct" DECIMAL(6,2),
    "startDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "status" "GoalStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_metrics" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "metricId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "goal_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goal_updates" (
    "id" UUID NOT NULL,
    "goalId" UUID NOT NULL,
    "actorId" UUID,
    "currentValue" DECIMAL(20,6),
    "progressPct" DECIMAL(6,2),
    "status" "GoalStatus",
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "problemStatement" TEXT NOT NULL,
    "context" TEXT,
    "ownerId" UUID,
    "status" "DecisionStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" "DecisionPriority" NOT NULL DEFAULT 'MEDIUM',
    "decisionDate" DATE,
    "expectedOutcome" TEXT,
    "reviewDate" DATE,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_actions" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" UUID,
    "dueDate" DATE,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_metrics" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "metricId" UUID NOT NULL,

    CONSTRAINT "decision_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_alerts" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "alertId" UUID NOT NULL,

    CONSTRAINT "decision_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_insights" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "insightId" UUID NOT NULL,

    CONSTRAINT "decision_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_goals" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "goalId" UUID NOT NULL,

    CONSTRAINT "decision_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decision_reviews" (
    "id" UUID NOT NULL,
    "decisionId" UUID NOT NULL,
    "reviewerId" UUID,
    "expectedOutcome" TEXT,
    "actualOutcome" TEXT,
    "result" "DecisionReviewResult",
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversations" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "AiMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_queries" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "contextSummary" JSONB NOT NULL,
    "model" TEXT,
    "latencyMs" INTEGER,
    "tokensPrompt" INTEGER,
    "tokensOutput" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_settings" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_expiresAt_idx" ON "refresh_tokens"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "organization_users_userId_idx" ON "organization_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_users_organizationId_userId_key" ON "organization_users"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "industries_code_key" ON "industries"("code");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "branches_organizationId_idx" ON "branches"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "branches_organizationId_code_key" ON "branches"("organizationId", "code");

-- CreateIndex
CREATE INDEX "departments_organizationId_branchId_idx" ON "departments"("organizationId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_organizationId_code_key" ON "departments"("organizationId", "code");

-- CreateIndex
CREATE INDEX "data_sources_organizationId_idx" ON "data_sources"("organizationId");

-- CreateIndex
CREATE INDEX "datasets_organizationId_idx" ON "datasets"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "datasets_organizationId_code_key" ON "datasets"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "dataset_columns_datasetId_code_key" ON "dataset_columns"("datasetId", "code");

-- CreateIndex
CREATE INDEX "data_imports_organizationId_status_idx" ON "data_imports"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "data_imports_organizationId_checksum_key" ON "data_imports"("organizationId", "checksum");

-- CreateIndex
CREATE INDEX "data_import_rows_dataImportId_status_idx" ON "data_import_rows"("dataImportId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "data_import_rows_dataImportId_rowNumber_key" ON "data_import_rows"("dataImportId", "rowNumber");

-- CreateIndex
CREATE INDEX "data_validation_errors_dataImportId_severity_idx" ON "data_validation_errors"("dataImportId", "severity");

-- CreateIndex
CREATE INDEX "metrics_organizationId_isActive_idx" ON "metrics"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_organizationId_code_key" ON "metrics"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "metrics_industryId_code_key" ON "metrics"("industryId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "metric_formulas_metricId_key" ON "metric_formulas"("metricId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_dependencies_metricId_dependsOnId_key" ON "metric_dependencies"("metricId", "dependsOnId");

-- CreateIndex
CREATE INDEX "metric_values_organizationId_metricId_periodStart_idx" ON "metric_values"("organizationId", "metricId", "periodStart");

-- CreateIndex
CREATE INDEX "metric_values_organizationId_periodStart_idx" ON "metric_values"("organizationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "metric_values_organizationId_metricId_branchId_departmentId_key" ON "metric_values"("organizationId", "metricId", "branchId", "departmentId", "periodType", "periodStart");

-- CreateIndex
CREATE INDEX "metric_targets_organizationId_metricId_idx" ON "metric_targets"("organizationId", "metricId");

-- CreateIndex
CREATE UNIQUE INDEX "metric_targets_organizationId_metricId_branchId_periodType__key" ON "metric_targets"("organizationId", "metricId", "branchId", "periodType", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "metric_thresholds_organizationId_metricId_key" ON "metric_thresholds"("organizationId", "metricId");

-- CreateIndex
CREATE UNIQUE INDEX "industry_packs_code_key" ON "industry_packs"("code");

-- CreateIndex
CREATE UNIQUE INDEX "industry_pack_metrics_industryPackId_metricId_key" ON "industry_pack_metrics"("industryPackId", "metricId");

-- CreateIndex
CREATE UNIQUE INDEX "industry_pack_insight_rules_industryPackId_code_key" ON "industry_pack_insight_rules"("industryPackId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "organization_industry_packs_organizationId_industryPackId_key" ON "organization_industry_packs"("organizationId", "industryPackId");

-- CreateIndex
CREATE INDEX "health_models_organizationId_isActive_idx" ON "health_models"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "health_categories_healthModelId_code_key" ON "health_categories"("healthModelId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "health_metric_weights_healthCategoryId_metricId_key" ON "health_metric_weights"("healthCategoryId", "metricId");

-- CreateIndex
CREATE INDEX "health_scores_organizationId_periodStart_idx" ON "health_scores"("organizationId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "health_scores_organizationId_healthModelId_branchId_periodT_key" ON "health_scores"("organizationId", "healthModelId", "branchId", "periodType", "periodStart");

-- CreateIndex
CREATE INDEX "alert_rules_organizationId_isActive_idx" ON "alert_rules"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "alerts_organizationId_status_severity_idx" ON "alerts"("organizationId", "status", "severity");

-- CreateIndex
CREATE INDEX "alerts_organizationId_createdAt_idx" ON "alerts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "alert_events_alertId_idx" ON "alert_events"("alertId");

-- CreateIndex
CREATE UNIQUE INDEX "insight_rules_organizationId_code_key" ON "insight_rules"("organizationId", "code");

-- CreateIndex
CREATE INDEX "insights_organizationId_createdAt_idx" ON "insights"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "insight_evidence_insightId_idx" ON "insight_evidence"("insightId");

-- CreateIndex
CREATE INDEX "goals_organizationId_status_idx" ON "goals"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "goal_metrics_goalId_metricId_key" ON "goal_metrics"("goalId", "metricId");

-- CreateIndex
CREATE INDEX "goal_updates_goalId_createdAt_idx" ON "goal_updates"("goalId", "createdAt");

-- CreateIndex
CREATE INDEX "decisions_organizationId_status_priority_idx" ON "decisions"("organizationId", "status", "priority");

-- CreateIndex
CREATE INDEX "decision_actions_decisionId_idx" ON "decision_actions"("decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_metrics_decisionId_metricId_key" ON "decision_metrics"("decisionId", "metricId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_alerts_decisionId_alertId_key" ON "decision_alerts"("decisionId", "alertId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_insights_decisionId_insightId_key" ON "decision_insights"("decisionId", "insightId");

-- CreateIndex
CREATE UNIQUE INDEX "decision_goals_decisionId_goalId_key" ON "decision_goals"("decisionId", "goalId");

-- CreateIndex
CREATE INDEX "decision_reviews_decisionId_idx" ON "decision_reviews"("decisionId");

-- CreateIndex
CREATE INDEX "ai_conversations_organizationId_userId_idx" ON "ai_conversations"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "ai_messages_conversationId_createdAt_idx" ON "ai_messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_queries_conversationId_createdAt_idx" ON "ai_queries"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_settings_organizationId_key_key" ON "organization_settings"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "platform_settings_key_key" ON "platform_settings"("key");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_users" ADD CONSTRAINT "organization_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dataset_columns" ADD CONSTRAINT "dataset_columns_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_imports" ADD CONSTRAINT "data_imports_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_import_rows" ADD CONSTRAINT "data_import_rows_dataImportId_fkey" FOREIGN KEY ("dataImportId") REFERENCES "data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_validation_errors" ADD CONSTRAINT "data_validation_errors_dataImportId_fkey" FOREIGN KEY ("dataImportId") REFERENCES "data_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_validation_errors" ADD CONSTRAINT "data_validation_errors_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "data_import_rows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metrics" ADD CONSTRAINT "metrics_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_formulas" ADD CONSTRAINT "metric_formulas_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_dependencies" ADD CONSTRAINT "metric_dependencies_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_dependencies" ADD CONSTRAINT "metric_dependencies_dependsOnId_fkey" FOREIGN KEY ("dependsOnId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_values" ADD CONSTRAINT "metric_values_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_values" ADD CONSTRAINT "metric_values_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_values" ADD CONSTRAINT "metric_values_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_values" ADD CONSTRAINT "metric_values_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_targets" ADD CONSTRAINT "metric_targets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_targets" ADD CONSTRAINT "metric_targets_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_thresholds" ADD CONSTRAINT "metric_thresholds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_thresholds" ADD CONSTRAINT "metric_thresholds_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_packs" ADD CONSTRAINT "industry_packs_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "industries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_pack_metrics" ADD CONSTRAINT "industry_pack_metrics_industryPackId_fkey" FOREIGN KEY ("industryPackId") REFERENCES "industry_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_pack_metrics" ADD CONSTRAINT "industry_pack_metrics_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_pack_health_models" ADD CONSTRAINT "industry_pack_health_models_industryPackId_fkey" FOREIGN KEY ("industryPackId") REFERENCES "industry_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "industry_pack_insight_rules" ADD CONSTRAINT "industry_pack_insight_rules_industryPackId_fkey" FOREIGN KEY ("industryPackId") REFERENCES "industry_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_industry_packs" ADD CONSTRAINT "organization_industry_packs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_industry_packs" ADD CONSTRAINT "organization_industry_packs_industryPackId_fkey" FOREIGN KEY ("industryPackId") REFERENCES "industry_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_models" ADD CONSTRAINT "health_models_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_categories" ADD CONSTRAINT "health_categories_healthModelId_fkey" FOREIGN KEY ("healthModelId") REFERENCES "health_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_metric_weights" ADD CONSTRAINT "health_metric_weights_healthCategoryId_fkey" FOREIGN KEY ("healthCategoryId") REFERENCES "health_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_metric_weights" ADD CONSTRAINT "health_metric_weights_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_healthModelId_fkey" FOREIGN KEY ("healthModelId") REFERENCES "health_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_scores" ADD CONSTRAINT "health_scores_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_rules" ADD CONSTRAINT "insight_rules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_insightRuleId_fkey" FOREIGN KEY ("insightRuleId") REFERENCES "insight_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insight_evidence" ADD CONSTRAINT "insight_evidence_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_metrics" ADD CONSTRAINT "goal_metrics_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_metrics" ADD CONSTRAINT "goal_metrics_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goal_updates" ADD CONSTRAINT "goal_updates_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_actions" ADD CONSTRAINT "decision_actions_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_metrics" ADD CONSTRAINT "decision_metrics_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_metrics" ADD CONSTRAINT "decision_metrics_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "metrics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_alerts" ADD CONSTRAINT "decision_alerts_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_alerts" ADD CONSTRAINT "decision_alerts_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "alerts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_insights" ADD CONSTRAINT "decision_insights_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_insights" ADD CONSTRAINT "decision_insights_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "insights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_goals" ADD CONSTRAINT "decision_goals_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_goals" ADD CONSTRAINT "decision_goals_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decision_reviews" ADD CONSTRAINT "decision_reviews_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_queries" ADD CONSTRAINT "ai_queries_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ai_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
