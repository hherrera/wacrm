import { relations } from "drizzle-orm/relations";
import { accounts, profiles, usersInAuth, tags, customFields, contacts, contactTags, contactCustomValues, conversations, whatsappConfig, messages, contactNotes, pipelines, pipelineStages, messageTemplates, deals, automations, broadcasts, broadcastRecipients, automationSteps, automationPendingExecutions, automationLogs, flows, flowNodes, messageReactions, flowRuns, flowRunEvents, accountInvitations, memberPresence, apiKeys, webhookEndpoints, notifications, aiKnowledgeDocuments, aiConfigs, quickReplies, aiKnowledgeChunks, aiUsageLog, pendingMessageStatuses } from "./schema";

export const profilesRelations = relations(profiles, ({one, many}) => ({
	account: one(accounts, {
		fields: [profiles.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [profiles.userId],
		references: [usersInAuth.id]
	}),
	deals: many(deals),
}));

export const accountsRelations = relations(accounts, ({one, many}) => ({
	profiles: many(profiles),
	tags: many(tags),
	customFields: many(customFields),
	contacts: many(contacts),
	conversations: many(conversations),
	whatsappConfigs: many(whatsappConfig),
	contactNotes: many(contactNotes),
	pipelines: many(pipelines),
	messageTemplates: many(messageTemplates),
	deals: many(deals),
	automations: many(automations),
	broadcasts: many(broadcasts),
	automationPendingExecutions: many(automationPendingExecutions),
	automationLogs: many(automationLogs),
	flows: many(flows),
	usersInAuth: one(usersInAuth, {
		fields: [accounts.ownerUserId],
		references: [usersInAuth.id]
	}),
	flowRuns: many(flowRuns),
	accountInvitations: many(accountInvitations),
	memberPresences: many(memberPresence),
	apiKeys: many(apiKeys),
	webhookEndpoints: many(webhookEndpoints),
	notifications: many(notifications),
	aiKnowledgeDocuments: many(aiKnowledgeDocuments),
	aiConfigs: many(aiConfigs),
	quickReplies: many(quickReplies),
	aiKnowledgeChunks: many(aiKnowledgeChunks),
	aiUsageLogs: many(aiUsageLog),
	pendingMessageStatuses: many(pendingMessageStatuses),
}));

export const usersInAuthRelations = relations(usersInAuth, ({many}) => ({
	profiles: many(profiles),
	tags: many(tags),
	customFields: many(customFields),
	contacts: many(contacts),
	conversations: many(conversations),
	whatsappConfigs: many(whatsappConfig),
	contactNotes: many(contactNotes),
	pipelines: many(pipelines),
	messageTemplates: many(messageTemplates),
	deals: many(deals),
	automations: many(automations),
	broadcasts: many(broadcasts),
	automationPendingExecutions: many(automationPendingExecutions),
	automationLogs: many(automationLogs),
	flows: many(flows),
	accounts: many(accounts),
	flowRuns: many(flowRuns),
	accountInvitations_acceptedByUserId: many(accountInvitations, {
		relationName: "accountInvitations_acceptedByUserId_usersInAuth_id"
	}),
	accountInvitations_createdByUserId: many(accountInvitations, {
		relationName: "accountInvitations_createdByUserId_usersInAuth_id"
	}),
	memberPresences: many(memberPresence),
	apiKeys: many(apiKeys),
	webhookEndpoints: many(webhookEndpoints),
	notifications_actorUserId: many(notifications, {
		relationName: "notifications_actorUserId_usersInAuth_id"
	}),
	notifications_userId: many(notifications, {
		relationName: "notifications_userId_usersInAuth_id"
	}),
	aiKnowledgeDocuments: many(aiKnowledgeDocuments),
	aiConfigs_createdBy: many(aiConfigs, {
		relationName: "aiConfigs_createdBy_usersInAuth_id"
	}),
	aiConfigs_handoffAgentId: many(aiConfigs, {
		relationName: "aiConfigs_handoffAgentId_usersInAuth_id"
	}),
	quickReplies: many(quickReplies),
}));

export const tagsRelations = relations(tags, ({one, many}) => ({
	account: one(accounts, {
		fields: [tags.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [tags.userId],
		references: [usersInAuth.id]
	}),
	contactTags: many(contactTags),
}));

export const customFieldsRelations = relations(customFields, ({one, many}) => ({
	account: one(accounts, {
		fields: [customFields.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [customFields.userId],
		references: [usersInAuth.id]
	}),
	contactCustomValues: many(contactCustomValues),
}));

export const contactTagsRelations = relations(contactTags, ({one}) => ({
	contact: one(contacts, {
		fields: [contactTags.contactId],
		references: [contacts.id]
	}),
	tag: one(tags, {
		fields: [contactTags.tagId],
		references: [tags.id]
	}),
}));

export const contactsRelations = relations(contacts, ({one, many}) => ({
	contactTags: many(contactTags),
	contactCustomValues: many(contactCustomValues),
	account: one(accounts, {
		fields: [contacts.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [contacts.userId],
		references: [usersInAuth.id]
	}),
	conversations: many(conversations),
	contactNotes: many(contactNotes),
	deals: many(deals),
	broadcastRecipients: many(broadcastRecipients),
	automationPendingExecutions: many(automationPendingExecutions),
	automationLogs: many(automationLogs),
	flowRuns: many(flowRuns),
	notifications: many(notifications),
}));

export const contactCustomValuesRelations = relations(contactCustomValues, ({one}) => ({
	contact: one(contacts, {
		fields: [contactCustomValues.contactId],
		references: [contacts.id]
	}),
	customField: one(customFields, {
		fields: [contactCustomValues.customFieldId],
		references: [customFields.id]
	}),
}));

export const conversationsRelations = relations(conversations, ({one, many}) => ({
	account: one(accounts, {
		fields: [conversations.accountId],
		references: [accounts.id]
	}),
	contact: one(contacts, {
		fields: [conversations.contactId],
		references: [contacts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [conversations.userId],
		references: [usersInAuth.id]
	}),
	messages: many(messages),
	deals: many(deals),
	messageReactions: many(messageReactions),
	flowRuns: many(flowRuns),
	notifications: many(notifications),
	aiUsageLogs: many(aiUsageLog),
}));

export const whatsappConfigRelations = relations(whatsappConfig, ({one}) => ({
	account: one(accounts, {
		fields: [whatsappConfig.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [whatsappConfig.userId],
		references: [usersInAuth.id]
	}),
}));

export const messagesRelations = relations(messages, ({one, many}) => ({
	conversation: one(conversations, {
		fields: [messages.conversationId],
		references: [conversations.id]
	}),
	message: one(messages, {
		fields: [messages.replyToMessageId],
		references: [messages.id],
		relationName: "messages_replyToMessageId_messages_id"
	}),
	messages: many(messages, {
		relationName: "messages_replyToMessageId_messages_id"
	}),
	messageReactions: many(messageReactions),
	flowRuns: many(flowRuns),
}));

export const contactNotesRelations = relations(contactNotes, ({one}) => ({
	account: one(accounts, {
		fields: [contactNotes.accountId],
		references: [accounts.id]
	}),
	contact: one(contacts, {
		fields: [contactNotes.contactId],
		references: [contacts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [contactNotes.userId],
		references: [usersInAuth.id]
	}),
}));

export const pipelinesRelations = relations(pipelines, ({one, many}) => ({
	account: one(accounts, {
		fields: [pipelines.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [pipelines.userId],
		references: [usersInAuth.id]
	}),
	pipelineStages: many(pipelineStages),
	deals: many(deals),
}));

export const pipelineStagesRelations = relations(pipelineStages, ({one, many}) => ({
	pipeline: one(pipelines, {
		fields: [pipelineStages.pipelineId],
		references: [pipelines.id]
	}),
	deals: many(deals),
}));

export const messageTemplatesRelations = relations(messageTemplates, ({one}) => ({
	account: one(accounts, {
		fields: [messageTemplates.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [messageTemplates.userId],
		references: [usersInAuth.id]
	}),
}));

export const dealsRelations = relations(deals, ({one}) => ({
	account: one(accounts, {
		fields: [deals.accountId],
		references: [accounts.id]
	}),
	profile: one(profiles, {
		fields: [deals.assignedTo],
		references: [profiles.id]
	}),
	contact: one(contacts, {
		fields: [deals.contactId],
		references: [contacts.id]
	}),
	conversation: one(conversations, {
		fields: [deals.conversationId],
		references: [conversations.id]
	}),
	pipeline: one(pipelines, {
		fields: [deals.pipelineId],
		references: [pipelines.id]
	}),
	pipelineStage: one(pipelineStages, {
		fields: [deals.stageId],
		references: [pipelineStages.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [deals.userId],
		references: [usersInAuth.id]
	}),
}));

export const automationsRelations = relations(automations, ({one, many}) => ({
	account: one(accounts, {
		fields: [automations.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [automations.userId],
		references: [usersInAuth.id]
	}),
	automationSteps: many(automationSteps),
	automationPendingExecutions: many(automationPendingExecutions),
	automationLogs: many(automationLogs),
}));

export const broadcastRecipientsRelations = relations(broadcastRecipients, ({one}) => ({
	broadcast: one(broadcasts, {
		fields: [broadcastRecipients.broadcastId],
		references: [broadcasts.id]
	}),
	contact: one(contacts, {
		fields: [broadcastRecipients.contactId],
		references: [contacts.id]
	}),
}));

export const broadcastsRelations = relations(broadcasts, ({one, many}) => ({
	broadcastRecipients: many(broadcastRecipients),
	account: one(accounts, {
		fields: [broadcasts.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [broadcasts.userId],
		references: [usersInAuth.id]
	}),
}));

export const automationStepsRelations = relations(automationSteps, ({one, many}) => ({
	automation: one(automations, {
		fields: [automationSteps.automationId],
		references: [automations.id]
	}),
	automationStep: one(automationSteps, {
		fields: [automationSteps.parentStepId],
		references: [automationSteps.id],
		relationName: "automationSteps_parentStepId_automationSteps_id"
	}),
	automationSteps: many(automationSteps, {
		relationName: "automationSteps_parentStepId_automationSteps_id"
	}),
	automationPendingExecutions: many(automationPendingExecutions),
}));

export const automationPendingExecutionsRelations = relations(automationPendingExecutions, ({one}) => ({
	account: one(accounts, {
		fields: [automationPendingExecutions.accountId],
		references: [accounts.id]
	}),
	automation: one(automations, {
		fields: [automationPendingExecutions.automationId],
		references: [automations.id]
	}),
	contact: one(contacts, {
		fields: [automationPendingExecutions.contactId],
		references: [contacts.id]
	}),
	automationLog: one(automationLogs, {
		fields: [automationPendingExecutions.logId],
		references: [automationLogs.id]
	}),
	automationStep: one(automationSteps, {
		fields: [automationPendingExecutions.parentStepId],
		references: [automationSteps.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [automationPendingExecutions.userId],
		references: [usersInAuth.id]
	}),
}));

export const automationLogsRelations = relations(automationLogs, ({one, many}) => ({
	automationPendingExecutions: many(automationPendingExecutions),
	account: one(accounts, {
		fields: [automationLogs.accountId],
		references: [accounts.id]
	}),
	automation: one(automations, {
		fields: [automationLogs.automationId],
		references: [automations.id]
	}),
	contact: one(contacts, {
		fields: [automationLogs.contactId],
		references: [contacts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [automationLogs.userId],
		references: [usersInAuth.id]
	}),
}));

export const flowNodesRelations = relations(flowNodes, ({one}) => ({
	flow: one(flows, {
		fields: [flowNodes.flowId],
		references: [flows.id]
	}),
}));

export const flowsRelations = relations(flows, ({one, many}) => ({
	flowNodes: many(flowNodes),
	account: one(accounts, {
		fields: [flows.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [flows.userId],
		references: [usersInAuth.id]
	}),
	flowRuns: many(flowRuns),
}));

export const messageReactionsRelations = relations(messageReactions, ({one}) => ({
	conversation: one(conversations, {
		fields: [messageReactions.conversationId],
		references: [conversations.id]
	}),
	message: one(messages, {
		fields: [messageReactions.messageId],
		references: [messages.id]
	}),
}));

export const flowRunEventsRelations = relations(flowRunEvents, ({one}) => ({
	flowRun: one(flowRuns, {
		fields: [flowRunEvents.flowRunId],
		references: [flowRuns.id]
	}),
}));

export const flowRunsRelations = relations(flowRuns, ({one, many}) => ({
	flowRunEvents: many(flowRunEvents),
	account: one(accounts, {
		fields: [flowRuns.accountId],
		references: [accounts.id]
	}),
	contact: one(contacts, {
		fields: [flowRuns.contactId],
		references: [contacts.id]
	}),
	conversation: one(conversations, {
		fields: [flowRuns.conversationId],
		references: [conversations.id]
	}),
	flow: one(flows, {
		fields: [flowRuns.flowId],
		references: [flows.id]
	}),
	message: one(messages, {
		fields: [flowRuns.lastPromptMessageId],
		references: [messages.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [flowRuns.userId],
		references: [usersInAuth.id]
	}),
}));

export const accountInvitationsRelations = relations(accountInvitations, ({one}) => ({
	usersInAuth_acceptedByUserId: one(usersInAuth, {
		fields: [accountInvitations.acceptedByUserId],
		references: [usersInAuth.id],
		relationName: "accountInvitations_acceptedByUserId_usersInAuth_id"
	}),
	account: one(accounts, {
		fields: [accountInvitations.accountId],
		references: [accounts.id]
	}),
	usersInAuth_createdByUserId: one(usersInAuth, {
		fields: [accountInvitations.createdByUserId],
		references: [usersInAuth.id],
		relationName: "accountInvitations_createdByUserId_usersInAuth_id"
	}),
}));

export const memberPresenceRelations = relations(memberPresence, ({one}) => ({
	account: one(accounts, {
		fields: [memberPresence.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [memberPresence.userId],
		references: [usersInAuth.id]
	}),
}));

export const apiKeysRelations = relations(apiKeys, ({one}) => ({
	account: one(accounts, {
		fields: [apiKeys.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [apiKeys.createdBy],
		references: [usersInAuth.id]
	}),
}));

export const webhookEndpointsRelations = relations(webhookEndpoints, ({one}) => ({
	account: one(accounts, {
		fields: [webhookEndpoints.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [webhookEndpoints.createdBy],
		references: [usersInAuth.id]
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	account: one(accounts, {
		fields: [notifications.accountId],
		references: [accounts.id]
	}),
	usersInAuth_actorUserId: one(usersInAuth, {
		fields: [notifications.actorUserId],
		references: [usersInAuth.id],
		relationName: "notifications_actorUserId_usersInAuth_id"
	}),
	contact: one(contacts, {
		fields: [notifications.contactId],
		references: [contacts.id]
	}),
	conversation: one(conversations, {
		fields: [notifications.conversationId],
		references: [conversations.id]
	}),
	usersInAuth_userId: one(usersInAuth, {
		fields: [notifications.userId],
		references: [usersInAuth.id],
		relationName: "notifications_userId_usersInAuth_id"
	}),
}));

export const aiKnowledgeDocumentsRelations = relations(aiKnowledgeDocuments, ({one, many}) => ({
	account: one(accounts, {
		fields: [aiKnowledgeDocuments.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [aiKnowledgeDocuments.createdBy],
		references: [usersInAuth.id]
	}),
	aiKnowledgeChunks: many(aiKnowledgeChunks),
}));

export const aiConfigsRelations = relations(aiConfigs, ({one}) => ({
	account: one(accounts, {
		fields: [aiConfigs.accountId],
		references: [accounts.id]
	}),
	usersInAuth_createdBy: one(usersInAuth, {
		fields: [aiConfigs.createdBy],
		references: [usersInAuth.id],
		relationName: "aiConfigs_createdBy_usersInAuth_id"
	}),
	usersInAuth_handoffAgentId: one(usersInAuth, {
		fields: [aiConfigs.handoffAgentId],
		references: [usersInAuth.id],
		relationName: "aiConfigs_handoffAgentId_usersInAuth_id"
	}),
}));

export const quickRepliesRelations = relations(quickReplies, ({one}) => ({
	account: one(accounts, {
		fields: [quickReplies.accountId],
		references: [accounts.id]
	}),
	usersInAuth: one(usersInAuth, {
		fields: [quickReplies.userId],
		references: [usersInAuth.id]
	}),
}));

export const aiKnowledgeChunksRelations = relations(aiKnowledgeChunks, ({one}) => ({
	account: one(accounts, {
		fields: [aiKnowledgeChunks.accountId],
		references: [accounts.id]
	}),
	aiKnowledgeDocument: one(aiKnowledgeDocuments, {
		fields: [aiKnowledgeChunks.documentId],
		references: [aiKnowledgeDocuments.id]
	}),
}));

export const aiUsageLogRelations = relations(aiUsageLog, ({one}) => ({
	account: one(accounts, {
		fields: [aiUsageLog.accountId],
		references: [accounts.id]
	}),
	conversation: one(conversations, {
		fields: [aiUsageLog.conversationId],
		references: [conversations.id]
	}),
}));

export const pendingMessageStatusesRelations = relations(pendingMessageStatuses, ({one}) => ({
	account: one(accounts, {
		fields: [pendingMessageStatuses.accountId],
		references: [accounts.id]
	}),
}));