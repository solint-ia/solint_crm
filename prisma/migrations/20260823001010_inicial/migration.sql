-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "document" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roleSlug" TEXT NOT NULL,
    "avatarTone" TEXT NOT NULL,
    "availability" TEXT NOT NULL DEFAULT 'disponivel',
    "teamsJson" TEXT NOT NULL DEFAULT '[]',
    "signature" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "permissionsJson" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Role_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "description" TEXT,
    "usageCount" INTEGER,
    CONSTRAINT "Label_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "channel" TEXT NOT NULL,
    "avatarTone" TEXT NOT NULL,
    "location" TEXT,
    "timezone" TEXT,
    "ownerName" TEXT,
    "lastContactAt" TEXT,
    "lastContactLabel" TEXT,
    "customFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "timelineJson" TEXT,
    "kind" TEXT DEFAULT 'pessoa',
    "avatarUrl" TEXT,
    "participantCount" INTEGER,
    CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "inboxId" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "statusLabel" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assigneeName" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessagePreview" TEXT NOT NULL DEFAULT '',
    "lastMessageAt" TEXT NOT NULL DEFAULT '',
    "lastActivityAt" DATETIME,
    "protocolsJson" TEXT NOT NULL DEFAULT '[]',
    "slaDeadlineAt" TEXT,
    "slaLabel" TEXT,
    "slaBreached" BOOLEAN,
    "isTyping" BOOLEAN,
    "collisionAgent" TEXT,
    "lastInboundAt" TEXT,
    "channelOffline" BOOLEAN,
    "channelThreadId" TEXT,
    CONSTRAINT "Conversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorName" TEXT,
    "contentType" TEXT NOT NULL,
    "contentJson" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryStatus" TEXT,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "replyToId" TEXT,
    "externalId" TEXT,
    "origin" TEXT,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Pipeline" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "Pipeline_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pipelineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "isWon" BOOLEAN NOT NULL DEFAULT false,
    "isLost" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PipelineStage_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "contactId" TEXT,
    "contactName" TEXT NOT NULL,
    "company" TEXT,
    "amountInCents" INTEGER NOT NULL,
    "ownerName" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "enteredStageAt" TEXT NOT NULL,
    "stageAgeLabel" TEXT NOT NULL,
    "nextAction" TEXT NOT NULL,
    "conversationId" TEXT,
    "historyJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "Deal_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "persona" TEXT NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "handledCount" INTEGER NOT NULL DEFAULT 0,
    "transferRate" TEXT NOT NULL,
    "knowledgeBaseJson" TEXT NOT NULL DEFAULT '[]',
    "transferRulesJson" TEXT NOT NULL DEFAULT '[]',
    "flowJson" TEXT NOT NULL DEFAULT '[]',
    "logsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "AiAgent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timeLabel" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "href" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "conditionsJson" TEXT NOT NULL DEFAULT '[]',
    "actionsJson" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,
    CONSTRAINT "Automation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "businessHoursJson" TEXT NOT NULL,
    "awayMessageJson" TEXT NOT NULL,
    "greetingJson" TEXT NOT NULL,
    "webhookUrl" TEXT,
    "teamName" TEXT,
    CONSTRAINT "ChannelConnection_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    CONSTRAINT "KnowledgeCategory_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedLabel" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "helpful" INTEGER NOT NULL DEFAULT 0,
    "notHelpful" INTEGER NOT NULL DEFAULT 0,
    "tagsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "KnowledgeArticle_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "KnowledgeCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AccountSettings" (
    "accountId" TEXT NOT NULL PRIMARY KEY,
    "assignmentMethod" TEXT NOT NULL DEFAULT 'round_robin',
    "macrosJson" TEXT NOT NULL DEFAULT '[]',
    "cannedResponsesJson" TEXT NOT NULL DEFAULT '[]',
    "webhooksJson" TEXT NOT NULL DEFAULT '[]',
    "apiTokensJson" TEXT NOT NULL DEFAULT '[]',
    "teamsJson" TEXT NOT NULL DEFAULT '[]',
    "customAttributesJson" TEXT NOT NULL DEFAULT '[]',
    "billingJson" TEXT NOT NULL,
    "auditLogJson" TEXT NOT NULL DEFAULT '[]',
    "activeSessionsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "AccountSettings_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ContactLabels" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ContactLabels_A_fkey" FOREIGN KEY ("A") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ContactLabels_B_fkey" FOREIGN KEY ("B") REFERENCES "Label" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_ConversationLabels" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_ConversationLabels_A_fkey" FOREIGN KEY ("A") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_ConversationLabels_B_fkey" FOREIGN KEY ("B") REFERENCES "Label" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_accountId_idx" ON "User"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenId_key" ON "AuthSession"("tokenId");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_accountId_slug_key" ON "Role"("accountId", "slug");

-- CreateIndex
CREATE INDEX "Label_accountId_idx" ON "Label"("accountId");

-- CreateIndex
CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- CreateIndex
CREATE INDEX "Conversation_accountId_lastActivityAt_idx" ON "Conversation"("accountId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Conversation_contactId_idx" ON "Conversation"("contactId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_externalId_idx" ON "Message"("externalId");

-- CreateIndex
CREATE INDEX "Pipeline_accountId_idx" ON "Pipeline"("accountId");

-- CreateIndex
CREATE INDEX "PipelineStage_pipelineId_idx" ON "PipelineStage"("pipelineId");

-- CreateIndex
CREATE INDEX "Deal_accountId_pipelineId_idx" ON "Deal"("accountId", "pipelineId");

-- CreateIndex
CREATE INDEX "Deal_stageId_idx" ON "Deal"("stageId");

-- CreateIndex
CREATE INDEX "AiAgent_accountId_idx" ON "AiAgent"("accountId");

-- CreateIndex
CREATE INDEX "Notification_accountId_userId_idx" ON "Notification"("accountId", "userId");

-- CreateIndex
CREATE INDEX "Automation_accountId_order_idx" ON "Automation"("accountId", "order");

-- CreateIndex
CREATE INDEX "ChannelConnection_accountId_idx" ON "ChannelConnection"("accountId");

-- CreateIndex
CREATE INDEX "KnowledgeCategory_accountId_idx" ON "KnowledgeCategory"("accountId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_accountId_categoryId_idx" ON "KnowledgeArticle"("accountId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "_ContactLabels_AB_unique" ON "_ContactLabels"("A", "B");

-- CreateIndex
CREATE INDEX "_ContactLabels_B_index" ON "_ContactLabels"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_ConversationLabels_AB_unique" ON "_ConversationLabels"("A", "B");

-- CreateIndex
CREATE INDEX "_ConversationLabels_B_index" ON "_ConversationLabels"("B");
