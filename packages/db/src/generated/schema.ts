import { pgTable, index, foreignKey, unique, pgPolicy, uuid, text, timestamp, jsonb, uniqueIndex, check, integer, boolean, numeric, date, vector, pgEnum } from "drizzle-orm/pg-core"
import { tsvector, usersInAuth, usersInAuth as users } from "../types"
export { usersInAuth }
import { sql } from "drizzle-orm"

export const accountRoleEnum = pgEnum("account_role_enum", ['owner', 'admin', 'agent', 'viewer'])


export const profiles = pgTable("profiles", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	fullName: text("full_name").notNull(),
	email: text().notNull(),
	avatarUrl: text("avatar_url"),
	role: text().default('user'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	betaFeatures: text("beta_features").array().default(["RAY"]).notNull(),
	accountId: uuid("account_id").notNull(),
	accountRole: accountRoleEnum("account_role").notNull(),
}, (table) => [
	index("idx_profiles_account_role").using("btree", table.accountId.asc().nullsLast().op("uuid_ops"), table.accountRole.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "profiles_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "profiles_user_id_fkey"
		}).onDelete("cascade"),
	unique("profiles_user_id_key").on(table.userId),
	pgPolicy("profiles_select", { as: "permissive", for: "select", to: ["public"], using: sql`((auth.uid() = user_id) OR is_account_member(account_id))` }),
	pgPolicy("profiles_update", { as: "permissive", for: "update", to: ["public"] }),
]);

export const tags = pgTable("tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	color: text().default('#3b82f6').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_tags_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "tags_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "tags_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("tags_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("tags_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("tags_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("tags_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const customFields = pgTable("custom_fields", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	fieldName: text("field_name").notNull(),
	fieldType: text("field_type").default('text').notNull(),
	fieldOptions: jsonb("field_options"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_custom_fields_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "custom_fields_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "custom_fields_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("custom_fields_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("custom_fields_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("custom_fields_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("custom_fields_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const contactTags = pgTable("contact_tags", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contactId: uuid("contact_id").notNull(),
	tagId: uuid("tag_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_contact_tags_contact").using("btree", table.contactId.asc().nullsLast().op("uuid_ops")),
	index("idx_contact_tags_tag").using("btree", table.tagId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "contact_tags_contact_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.tagId],
			foreignColumns: [tags.id],
			name: "contact_tags_tag_id_fkey"
		}).onDelete("cascade"),
	unique("contact_tags_contact_id_tag_id_key").on(table.contactId, table.tagId),
	pgPolicy("contact_tags_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_tags.contact_id) AND is_account_member(c.account_id))))` }),
	pgPolicy("contact_tags_modify", { as: "permissive", for: "all", to: ["public"] }),
]);

export const contactCustomValues = pgTable("contact_custom_values", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contactId: uuid("contact_id").notNull(),
	customFieldId: uuid("custom_field_id").notNull(),
	value: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "contact_custom_values_contact_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.customFieldId],
			foreignColumns: [customFields.id],
			name: "contact_custom_values_custom_field_id_fkey"
		}).onDelete("cascade"),
	unique("contact_custom_values_contact_id_custom_field_id_key").on(table.contactId, table.customFieldId),
	pgPolicy("contact_custom_values_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM contacts c
  WHERE ((c.id = contact_custom_values.contact_id) AND is_account_member(c.account_id))))` }),
	pgPolicy("contact_custom_values_modify", { as: "permissive", for: "all", to: ["public"] }),
]);

export const contacts = pgTable("contacts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	phone: text().notNull(),
	name: text(),
	email: text(),
	company: text(),
	avatarUrl: text("avatar_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	accountId: uuid("account_id").notNull(),
	phoneNormalized: text("phone_normalized").generatedAlwaysAs(sql`regexp_replace(phone, '\D'::text, ''::text, 'g'::text)`),
	waUserId: text("wa_user_id"),
	waParentUserId: text("wa_parent_user_id"),
	waUsername: text("wa_username"),
}, (table) => [
	index("idx_contacts_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_contacts_account_phone_normalized").using("btree", table.accountId.asc().nullsLast().op("text_ops"), table.phoneNormalized.asc().nullsLast().op("text_ops")).where(sql`(phone_normalized <> ''::text)`),
	uniqueIndex("idx_contacts_account_wa_user_id").using("btree", table.accountId.asc().nullsLast().op("text_ops"), table.waUserId.asc().nullsLast().op("uuid_ops")).where(sql`(wa_user_id IS NOT NULL)`),
	index("idx_contacts_phone").using("btree", table.phone.asc().nullsLast().op("text_ops")),
	index("idx_contacts_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "contacts_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "contacts_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("contacts_update", { as: "permissive", for: "update", to: ["public"], using: sql`is_account_member(account_id, 'agent'::account_role_enum)` }),
	pgPolicy("contacts_select", { as: "permissive", for: "select", to: ["public"] }),
	pgPolicy("contacts_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("contacts_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const conversations = pgTable("conversations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	contactId: uuid("contact_id").notNull(),
	status: text().default('open').notNull(),
	assignedAgentId: uuid("assigned_agent_id"),
	lastMessageText: text("last_message_text"),
	lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: 'string' }),
	unreadCount: integer("unread_count").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	accountId: uuid("account_id").notNull(),
	aiAutoreplyDisabled: boolean("ai_autoreply_disabled").default(false).notNull(),
	aiReplyCount: integer("ai_reply_count").default(0).notNull(),
	aiHandoffSummary: text("ai_handoff_summary"),
	firstInboundAt: timestamp("first_inbound_at", { withTimezone: true, mode: 'string' }),
	lastInboundAt: timestamp("last_inbound_at", { withTimezone: true, mode: 'string' }),
	lastReplyAt: timestamp("last_reply_at", { withTimezone: true, mode: 'string' }),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_conversations_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_conversations_account_awaiting").using("btree", table.accountId.asc().nullsLast().op("timestamptz_ops"), table.lastInboundAt.asc().nullsLast().op("uuid_ops")).where(sql`((status <> 'closed'::text) AND (last_inbound_at IS NOT NULL))`),
	index("idx_conversations_account_closed").using("btree", table.accountId.asc().nullsLast().op("uuid_ops"), table.closedAt.asc().nullsLast().op("uuid_ops")).where(sql`(closed_at IS NOT NULL)`),
	uniqueIndex("idx_conversations_account_contact").using("btree", table.accountId.asc().nullsLast().op("uuid_ops"), table.contactId.asc().nullsLast().op("uuid_ops")),
	index("idx_conversations_account_created").using("btree", table.accountId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("uuid_ops")),
	index("idx_conversations_contact_id").using("btree", table.contactId.asc().nullsLast().op("uuid_ops")),
	index("idx_conversations_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "conversations_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "conversations_contact_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "conversations_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("conversations_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("conversations_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("conversations_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("conversations_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("conversations_status_check", sql`status = ANY (ARRAY['open'::text, 'pending'::text, 'closed'::text])`),
]);

export const whatsappConfig = pgTable("whatsapp_config", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	phoneNumberId: text("phone_number_id").notNull(),
	wabaId: text("waba_id"),
	accessToken: text("access_token").notNull(),
	verifyToken: text("verify_token"),
	status: text().default('disconnected').notNull(),
	connectedAt: timestamp("connected_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	registeredAt: timestamp("registered_at", { withTimezone: true, mode: 'string' }),
	subscribedAppsAt: timestamp("subscribed_apps_at", { withTimezone: true, mode: 'string' }),
	lastRegistrationError: text("last_registration_error"),
	accountId: uuid("account_id").notNull(),
	mirrorInboundMedia: boolean("mirror_inbound_media").default(true).notNull(),
}, (table) => [
	index("idx_whatsapp_config_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_whatsapp_config_registered_at").using("btree", table.registeredAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(registered_at IS NULL)`),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "whatsapp_config_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "whatsapp_config_user_id_fkey"
		}).onDelete("cascade"),
	unique("whatsapp_config_phone_number_id_key").on(table.phoneNumberId),
	unique("whatsapp_config_account_id_key").on(table.accountId),
	pgPolicy("whatsapp_config_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("whatsapp_config_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("whatsapp_config_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("whatsapp_config_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("whatsapp_config_status_check", sql`status = ANY (ARRAY['connected'::text, 'disconnected'::text])`),
]);

export const messages = pgTable("messages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	conversationId: uuid("conversation_id").notNull(),
	senderType: text("sender_type").notNull(),
	senderId: uuid("sender_id"),
	contentType: text("content_type").default('text').notNull(),
	contentText: text("content_text"),
	mediaUrl: text("media_url"),
	templateName: text("template_name"),
	messageId: text("message_id"),
	status: text().default('sent').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	replyToMessageId: uuid("reply_to_message_id"),
	interactiveReplyId: text("interactive_reply_id"),
	aiGenerated: boolean("ai_generated").default(false).notNull(),
	interactivePayload: jsonb("interactive_payload"),
	mediaType: text("media_type"),
	errorCode: integer("error_code"),
	errorTitle: text("error_title"),
	errorDetails: text("error_details"),
}, (table) => [
	index("idx_messages_conversation").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops")),
	index("idx_messages_conversation_created").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops"), table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	uniqueIndex("idx_messages_conversation_message_id").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops"), table.messageId.asc().nullsLast().op("text_ops")),
	index("idx_messages_message_id").using("btree", table.messageId.asc().nullsLast().op("text_ops")),
	index("idx_messages_reply_to").using("btree", table.replyToMessageId.asc().nullsLast().op("uuid_ops")).where(sql`(reply_to_message_id IS NOT NULL)`),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "messages_conversation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.replyToMessageId],
			foreignColumns: [table.id],
			name: "messages_reply_to_message_id_fkey"
		}).onDelete("set null"),
	pgPolicy("messages_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND is_account_member(c.account_id))))` }),
	pgPolicy("messages_modify", { as: "permissive", for: "all", to: ["public"] }),
	check("messages_content_type_check", sql`content_type = ANY (ARRAY['text'::text, 'image'::text, 'document'::text, 'audio'::text, 'video'::text, 'location'::text, 'template'::text, 'interactive'::text])`),
	check("messages_sender_type_check", sql`sender_type = ANY (ARRAY['customer'::text, 'agent'::text, 'bot'::text])`),
	check("messages_status_check", sql`status = ANY (ARRAY['sending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'failed'::text])`),
]);

export const contactNotes = pgTable("contact_notes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	contactId: uuid("contact_id").notNull(),
	userId: uuid("user_id").notNull(),
	noteText: text("note_text").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_contact_notes_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "contact_notes_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "contact_notes_contact_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "contact_notes_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("contact_notes_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("contact_notes_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("contact_notes_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("contact_notes_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const pipelines = pgTable("pipelines", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_pipelines_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "pipelines_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "pipelines_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("pipelines_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("pipelines_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("pipelines_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("pipelines_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const pipelineStages = pgTable("pipeline_stages", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	pipelineId: uuid("pipeline_id").notNull(),
	name: text().notNull(),
	position: integer().default(0).notNull(),
	color: text().default('#3b82f6').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	index("idx_pipeline_stages_pipeline").using("btree", table.pipelineId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.pipelineId],
			foreignColumns: [pipelines.id],
			name: "pipeline_stages_pipeline_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("pipeline_stages_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM pipelines p
  WHERE ((p.id = pipeline_stages.pipeline_id) AND is_account_member(p.account_id))))` }),
	pgPolicy("pipeline_stages_modify", { as: "permissive", for: "all", to: ["public"] }),
]);

export const messageTemplates = pgTable("message_templates", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	category: text().default('Marketing').notNull(),
	language: text().default('en_US'),
	headerType: text("header_type"),
	headerContent: text("header_content"),
	bodyText: text("body_text").notNull(),
	footerText: text("footer_text"),
	buttons: jsonb(),
	status: text().default('DRAFT'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	sampleValues: jsonb("sample_values"),
	metaTemplateId: text("meta_template_id"),
	rejectionReason: text("rejection_reason"),
	qualityScore: text("quality_score"),
	headerHandle: text("header_handle"),
	headerMediaUrl: text("header_media_url"),
	submissionError: text("submission_error"),
	lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true, mode: 'string' }),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_message_templates_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_message_templates_meta_template_id").using("btree", table.metaTemplateId.asc().nullsLast().op("text_ops")).where(sql`(meta_template_id IS NOT NULL)`),
	uniqueIndex("message_templates_account_name_language_key").using("btree", table.accountId.asc().nullsLast().op("text_ops"), table.name.asc().nullsLast().op("uuid_ops"), table.language.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "message_templates_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "message_templates_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("message_templates_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("message_templates_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("message_templates_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("message_templates_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("message_templates_buttons_shape_check", sql`(buttons IS NULL) OR ((jsonb_typeof(buttons) = 'array'::text) AND (jsonb_array_length(buttons) <= 10))`),
	check("message_templates_category_check", sql`category = ANY (ARRAY['Marketing'::text, 'Utility'::text, 'Authentication'::text])`),
	check("message_templates_header_type_check", sql`header_type = ANY (ARRAY['text'::text, 'image'::text, 'video'::text, 'document'::text])`),
	check("message_templates_quality_score_check", sql`(quality_score IS NULL) OR (quality_score = ANY (ARRAY['GREEN'::text, 'YELLOW'::text, 'RED'::text]))`),
	check("message_templates_status_meta_check", sql`status = ANY (ARRAY['DRAFT'::text, 'PENDING'::text, 'APPROVED'::text, 'REJECTED'::text, 'PAUSED'::text, 'DISABLED'::text, 'IN_APPEAL'::text, 'PENDING_DELETION'::text])`),
]);

export const deals = pgTable("deals", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	pipelineId: uuid("pipeline_id").notNull(),
	stageId: uuid("stage_id").notNull(),
	contactId: uuid("contact_id"),
	conversationId: uuid("conversation_id"),
	title: text().notNull(),
	value: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	currency: text().default('USD'),
	notes: text(),
	expectedCloseDate: date("expected_close_date"),
	status: text().default('open'),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	assignedTo: uuid("assigned_to"),
	accountId: uuid("account_id").notNull(),
	closedAt: timestamp("closed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_deals_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_deals_account_closed").using("btree", table.accountId.asc().nullsLast().op("timestamptz_ops"), table.closedAt.asc().nullsLast().op("uuid_ops")).where(sql`(closed_at IS NOT NULL)`),
	index("idx_deals_assigned_to").using("btree", table.assignedTo.asc().nullsLast().op("uuid_ops")),
	index("idx_deals_pipeline").using("btree", table.pipelineId.asc().nullsLast().op("uuid_ops")),
	index("idx_deals_stage").using("btree", table.stageId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "deals_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [profiles.id],
			name: "deals_assigned_to_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "deals_contact_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "deals_conversation_id_fkey"
		}),
	foreignKey({
			columns: [table.pipelineId],
			foreignColumns: [pipelines.id],
			name: "deals_pipeline_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.stageId],
			foreignColumns: [pipelineStages.id],
			name: "deals_stage_id_fkey"
		}),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "deals_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("deals_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("deals_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("deals_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("deals_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("deals_status_check", sql`status = ANY (ARRAY['open'::text, 'won'::text, 'lost'::text])`),
]);

export const automations = pgTable("automations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	description: text(),
	triggerType: text("trigger_type").notNull(),
	triggerConfig: jsonb("trigger_config").default({}).notNull(),
	isActive: boolean("is_active").default(false).notNull(),
	executionCount: integer("execution_count").default(0).notNull(),
	lastExecutedAt: timestamp("last_executed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_automations_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_automations_account_active_trigger").using("btree", table.accountId.asc().nullsLast().op("text_ops"), table.triggerType.asc().nullsLast().op("uuid_ops")).where(sql`(is_active = true)`),
	index("idx_automations_active_trigger").using("btree", table.triggerType.asc().nullsLast().op("text_ops")).where(sql`(is_active = true)`),
	index("idx_automations_user_id").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "automations_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "automations_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("automations_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("automations_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("automations_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("automations_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const broadcastRecipients = pgTable("broadcast_recipients", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	broadcastId: uuid("broadcast_id").notNull(),
	contactId: uuid("contact_id"),
	status: text().default('pending').notNull(),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: 'string' }),
	deliveredAt: timestamp("delivered_at", { withTimezone: true, mode: 'string' }),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	repliedAt: timestamp("replied_at", { withTimezone: true, mode: 'string' }),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	whatsappMessageId: text("whatsapp_message_id"),
	templateParams: jsonb("template_params"),
}, (table) => [
	index("idx_broadcast_recipients_broadcast").using("btree", table.broadcastId.asc().nullsLast().op("uuid_ops")),
	index("idx_broadcast_recipients_broadcast_status").using("btree", table.broadcastId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_broadcast_recipients_wamid").using("btree", table.whatsappMessageId.asc().nullsLast().op("text_ops")).where(sql`(whatsapp_message_id IS NOT NULL)`),
	foreignKey({
			columns: [table.broadcastId],
			foreignColumns: [broadcasts.id],
			name: "broadcast_recipients_broadcast_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "broadcast_recipients_contact_id_fkey"
		}).onDelete("set null"),
	pgPolicy("broadcast_recipients_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM broadcasts b
  WHERE ((b.id = broadcast_recipients.broadcast_id) AND is_account_member(b.account_id))))` }),
	pgPolicy("broadcast_recipients_modify", { as: "permissive", for: "all", to: ["public"] }),
	check("broadcast_recipients_status_check", sql`status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'read'::text, 'replied'::text, 'failed'::text])`),
]);

export const broadcasts = pgTable("broadcasts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	templateName: text("template_name").notNull(),
	templateLanguage: text("template_language").default('en_US').notNull(),
	templateVariables: jsonb("template_variables"),
	audienceFilter: jsonb("audience_filter"),
	scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: 'string' }),
	status: text().default('draft').notNull(),
	totalRecipients: integer("total_recipients").default(0),
	sentCount: integer("sent_count").default(0),
	deliveredCount: integer("delivered_count").default(0),
	readCount: integer("read_count").default(0),
	repliedCount: integer("replied_count").default(0),
	failedCount: integer("failed_count").default(0),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	accountId: uuid("account_id").notNull(),
	deliveryLockedAt: timestamp("delivery_locked_at", { withTimezone: true, mode: 'string' }),
	deliveryLeaseUntil: timestamp("delivery_lease_until", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_broadcasts_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "broadcasts_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "broadcasts_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("broadcasts_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("broadcasts_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("broadcasts_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("broadcasts_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("broadcasts_status_check", sql`status = ANY (ARRAY['draft'::text, 'scheduled'::text, 'sending'::text, 'sent'::text, 'failed'::text])`),
]);

export const automationSteps = pgTable("automation_steps", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	automationId: uuid("automation_id").notNull(),
	parentStepId: uuid("parent_step_id"),
	branch: text(),
	stepType: text("step_type").notNull(),
	stepConfig: jsonb("step_config").default({}).notNull(),
	position: integer().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_automation_steps_automation_id").using("btree", table.automationId.asc().nullsLast().op("int4_ops"), table.position.asc().nullsLast().op("int4_ops")),
	index("idx_automation_steps_parent").using("btree", table.parentStepId.asc().nullsLast().op("uuid_ops")).where(sql`(parent_step_id IS NOT NULL)`),
	foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "automation_steps_automation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentStepId],
			foreignColumns: [table.id],
			name: "automation_steps_parent_step_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("automation_steps_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM automations a
  WHERE ((a.id = automation_steps.automation_id) AND is_account_member(a.account_id))))` }),
	pgPolicy("automation_steps_modify", { as: "permissive", for: "all", to: ["public"] }),
	check("automation_steps_branch_check", sql`branch = ANY (ARRAY['yes'::text, 'no'::text])`),
]);

export const automationPendingExecutions = pgTable("automation_pending_executions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	automationId: uuid("automation_id").notNull(),
	userId: uuid("user_id").notNull(),
	contactId: uuid("contact_id"),
	logId: uuid("log_id"),
	parentStepId: uuid("parent_step_id"),
	branch: text(),
	nextStepPosition: integer("next_step_position").notNull(),
	context: jsonb().default({}).notNull(),
	status: text().default('pending').notNull(),
	runAt: timestamp("run_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accountId: uuid("account_id").notNull(),
	claimedAt: timestamp("claimed_at", { withTimezone: true, mode: 'string' }),
	parkedStepId: uuid("parked_step_id"),
}, (table) => [
	index("idx_automation_pending_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_automation_pending_awaiting_reply").using("btree", table.accountId.asc().nullsLast().op("uuid_ops"), table.contactId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'awaiting_reply'::text)`),
	index("idx_automation_pending_due").using("btree", table.runAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'pending'::text)`),
	index("idx_automation_pending_stalled").using("btree", table.claimedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'running'::text)`),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "automation_pending_executions_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "automation_pending_executions_automation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "automation_pending_executions_contact_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.logId],
			foreignColumns: [automationLogs.id],
			name: "automation_pending_executions_log_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.parentStepId],
			foreignColumns: [automationSteps.id],
			name: "automation_pending_executions_parent_step_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "automation_pending_executions_user_id_fkey"
		}).onDelete("cascade"),
	check("automation_pending_executions_branch_check", sql`branch = ANY (ARRAY['yes'::text, 'no'::text])`),
	check("automation_pending_executions_status_check", sql`status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'failed'::text, 'awaiting_reply'::text, 'expired'::text, 'superseded'::text])`),
]);

export const flowNodes = pgTable("flow_nodes", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	flowId: uuid("flow_id").notNull(),
	nodeKey: text("node_key").notNull(),
	nodeType: text("node_type").notNull(),
	config: jsonb().default({}).notNull(),
	positionX: integer("position_x").default(0).notNull(),
	positionY: integer("position_y").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_flow_nodes_flow").using("btree", table.flowId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.flowId],
			foreignColumns: [flows.id],
			name: "flow_nodes_flow_id_fkey"
		}).onDelete("cascade"),
	unique("flow_nodes_flow_id_node_key_key").on(table.flowId, table.nodeKey),
	pgPolicy("flow_nodes_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM flows f
  WHERE ((f.id = flow_nodes.flow_id) AND is_account_member(f.account_id))))` }),
	pgPolicy("flow_nodes_modify", { as: "permissive", for: "all", to: ["public"] }),
	check("flow_nodes_node_type_check", sql`node_type = ANY (ARRAY['start'::text, 'send_buttons'::text, 'send_list'::text, 'send_message'::text, 'send_media'::text, 'collect_input'::text, 'condition'::text, 'set_tag'::text, 'handoff'::text, 'http_fetch'::text, 'end'::text])`),
]);

export const messageReactions = pgTable("message_reactions", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	messageId: uuid("message_id").notNull(),
	conversationId: uuid("conversation_id").notNull(),
	actorType: text("actor_type").notNull(),
	actorId: uuid("actor_id"),
	emoji: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_message_reactions_conversation").using("btree", table.conversationId.asc().nullsLast().op("uuid_ops")),
	index("idx_message_reactions_message").using("btree", table.messageId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("idx_message_reactions_one_agent_reaction").using("btree", table.messageId.asc().nullsLast().op("uuid_ops")).where(sql`(actor_type = 'agent'::text)`),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "message_reactions_conversation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.messageId],
			foreignColumns: [messages.id],
			name: "message_reactions_message_id_fkey"
		}).onDelete("cascade"),
	unique("message_reactions_message_id_actor_type_actor_id_key").on(table.messageId, table.actorType, table.actorId),
	pgPolicy("message_reactions_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM (messages m
     JOIN conversations c ON ((c.id = m.conversation_id)))
  WHERE ((m.id = message_reactions.message_id) AND is_account_member(c.account_id))))` }),
	pgPolicy("message_reactions_modify", { as: "permissive", for: "all", to: ["public"] }),
	check("message_reactions_actor_type_check", sql`actor_type = ANY (ARRAY['customer'::text, 'agent'::text])`),
]);

export const automationLogs = pgTable("automation_logs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	automationId: uuid("automation_id").notNull(),
	userId: uuid("user_id").notNull(),
	contactId: uuid("contact_id"),
	triggerEvent: text("trigger_event").notNull(),
	stepsExecuted: jsonb("steps_executed").default([]).notNull(),
	status: text().notNull(),
	errorMessage: text("error_message"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_automation_logs_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_automation_logs_automation").using("btree", table.automationId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_automation_logs_user").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "automation_logs_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.automationId],
			foreignColumns: [automations.id],
			name: "automation_logs_automation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "automation_logs_contact_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "automation_logs_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("automation_logs_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	check("automation_logs_status_check", sql`status = ANY (ARRAY['success'::text, 'partial'::text, 'failed'::text])`),
]);

export const flows = pgTable("flows", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	name: text().notNull(),
	description: text(),
	status: text().default('draft').notNull(),
	triggerType: text("trigger_type").notNull(),
	triggerConfig: jsonb("trigger_config").default({}).notNull(),
	entryNodeId: text("entry_node_id"),
	fallbackPolicy: jsonb("fallback_policy").default({"on_exhaust":"handoff","max_reprompts":2,"on_timeout_hours":24,"on_unknown_reply":"reprompt"}).notNull(),
	executionCount: integer("execution_count").default(0).notNull(),
	lastExecutedAt: timestamp("last_executed_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("idx_flows_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_flows_account_active").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'active'::text)`),
	index("idx_flows_active_trigger").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.triggerType.asc().nullsLast().op("text_ops")).where(sql`(status = 'active'::text)`),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "flows_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "flows_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("flows_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("flows_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("flows_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("flows_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("flows_status_check", sql`status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])`),
	check("flows_trigger_type_check", sql`trigger_type = ANY (ARRAY['keyword'::text, 'first_inbound_message'::text, 'manual'::text])`),
]);

export const accounts = pgTable("accounts", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	name: text().notNull(),
	ownerUserId: uuid("owner_user_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	defaultCurrency: text("default_currency").default('USD').notNull(),
	replyTargetMinutes: integer("reply_target_minutes").default(5).notNull(),
}, (table) => [
	uniqueIndex("idx_accounts_one_per_owner").using("btree", table.ownerUserId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.ownerUserId],
			foreignColumns: [users.id],
			name: "accounts_owner_user_id_fkey"
		}).onDelete("restrict"),
	pgPolicy("accounts_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(id)` }),
	pgPolicy("accounts_update", { as: "permissive", for: "update", to: ["public"] }),
	check("accounts_default_currency_format", sql`default_currency ~ '^[A-Z]{3}$'::text`),
	check("accounts_reply_target_minutes_range", sql`(reply_target_minutes >= 1) AND (reply_target_minutes <= 1440)`),
]);

export const flowRunEvents = pgTable("flow_run_events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	flowRunId: uuid("flow_run_id").notNull(),
	eventType: text("event_type").notNull(),
	nodeKey: text("node_key"),
	payload: jsonb().default({}).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_flow_run_events_run_time").using("btree", table.flowRunId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("uuid_ops")),
	index("idx_flow_run_events_run_type").using("btree", table.flowRunId.asc().nullsLast().op("uuid_ops"), table.eventType.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.flowRunId],
			foreignColumns: [flowRuns.id],
			name: "flow_run_events_flow_run_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("flow_run_events_select", { as: "permissive", for: "select", to: ["public"], using: sql`(EXISTS ( SELECT 1
   FROM flow_runs r
  WHERE ((r.id = flow_run_events.flow_run_id) AND is_account_member(r.account_id))))` }),
	check("flow_run_events_event_type_check", sql`event_type = ANY (ARRAY['started'::text, 'node_entered'::text, 'message_sent'::text, 'reply_received'::text, 'fallback_fired'::text, 'handoff'::text, 'timeout'::text, 'error'::text, 'completed'::text])`),
]);

export const flowRuns = pgTable("flow_runs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	flowId: uuid("flow_id").notNull(),
	userId: uuid("user_id").notNull(),
	contactId: uuid("contact_id"),
	conversationId: uuid("conversation_id"),
	status: text().default('active').notNull(),
	currentNodeKey: text("current_node_key"),
	lastPromptMessageId: uuid("last_prompt_message_id"),
	vars: jsonb().default({}).notNull(),
	repromptCount: integer("reprompt_count").default(0).notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastAdvancedAt: timestamp("last_advanced_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	endedAt: timestamp("ended_at", { withTimezone: true, mode: 'string' }),
	endReason: text("end_reason"),
	accountId: uuid("account_id").notNull(),
	transitionSeq: integer("transition_seq").default(0).notNull(),
}, (table) => [
	index("idx_flow_runs_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("idx_flow_runs_active_advanced").using("btree", table.lastAdvancedAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(status = 'active'::text)`),
	index("idx_flow_runs_flow_started").using("btree", table.flowId.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("idx_one_active_run_per_contact").using("btree", table.accountId.asc().nullsLast().op("uuid_ops"), table.contactId.asc().nullsLast().op("uuid_ops")).where(sql`(status = 'active'::text)`),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "flow_runs_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "flow_runs_contact_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "flow_runs_conversation_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.flowId],
			foreignColumns: [flows.id],
			name: "flow_runs_flow_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.lastPromptMessageId],
			foreignColumns: [messages.id],
			name: "flow_runs_last_prompt_message_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "flow_runs_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("flow_runs_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	check("flow_runs_status_check", sql`status = ANY (ARRAY['active'::text, 'completed'::text, 'handed_off'::text, 'timed_out'::text, 'paused_by_agent'::text, 'cancelled'::text, 'failed'::text])`),
]);

export const accountInvitations = pgTable("account_invitations", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	role: accountRoleEnum().notNull(),
	createdByUserId: uuid("created_by_user_id"),
	label: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: 'string' }),
	acceptedByUserId: uuid("accepted_by_user_id"),
}, (table) => [
	index("idx_account_invitations_account_pending").using("btree", table.accountId.asc().nullsLast().op("timestamptz_ops"), table.expiresAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(accepted_at IS NULL)`),
	foreignKey({
			columns: [table.acceptedByUserId],
			foreignColumns: [users.id],
			name: "account_invitations_accepted_by_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "account_invitations_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [users.id],
			name: "account_invitations_created_by_user_id_fkey"
		}).onDelete("set null"),
	unique("account_invitations_token_hash_key").on(table.tokenHash),
	pgPolicy("account_invitations_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id, 'admin'::account_role_enum)` }),
	pgPolicy("account_invitations_modify", { as: "permissive", for: "all", to: ["public"] }),
	check("account_invitations_role_check", sql`role <> 'owner'::account_role_enum`),
]);

export const memberPresence = pgTable("member_presence", {
	userId: uuid("user_id").primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	status: text().default('online').notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("member_presence_account_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "member_presence_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "member_presence_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("member_presence_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	check("member_presence_status_check", sql`status = ANY (ARRAY['online'::text, 'away'::text])`),
]);

export const apiKeys = pgTable("api_keys", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	createdBy: uuid("created_by"),
	name: text().notNull(),
	keyPrefix: text("key_prefix").notNull(),
	keyHash: text("key_hash").notNull(),
	scopes: text().array().default([""]).notNull(),
	lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("api_keys_account_id_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("api_keys_key_hash_idx").using("btree", table.keyHash.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "api_keys_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "api_keys_created_by_fkey"
		}).onDelete("set null"),
	unique("api_keys_key_hash_key").on(table.keyHash),
	pgPolicy("api_keys_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("api_keys_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("api_keys_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("api_keys_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const webhookEndpoints = pgTable("webhook_endpoints", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	createdBy: uuid("created_by"),
	url: text().notNull(),
	secret: text().notNull(),
	events: text().array().default([""]).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true, mode: 'string' }),
	failureCount: integer("failure_count").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("webhook_endpoints_account_id_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "webhook_endpoints_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "webhook_endpoints_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("webhook_endpoints_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`is_account_member(account_id, 'admin'::account_role_enum)`  }),
	pgPolicy("webhook_endpoints_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("webhook_endpoints_delete", { as: "permissive", for: "delete", to: ["public"] }),
	pgPolicy("webhook_endpoints_select", { as: "permissive", for: "select", to: ["public"] }),
]);

export const notifications = pgTable("notifications", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	userId: uuid("user_id").notNull(),
	type: text().default('conversation_assigned').notNull(),
	conversationId: uuid("conversation_id"),
	contactId: uuid("contact_id"),
	actorUserId: uuid("actor_user_id"),
	title: text().notNull(),
	body: text(),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_notifications_user_created").using("btree", table.userId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("idx_notifications_user_unread").using("btree", table.userId.asc().nullsLast().op("uuid_ops")).where(sql`(read_at IS NULL)`),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "notifications_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.actorUserId],
			foreignColumns: [users.id],
			name: "notifications_actor_user_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [contacts.id],
			name: "notifications_contact_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "notifications_conversation_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "notifications_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("notifications_select", { as: "permissive", for: "select", to: ["public"], using: sql`(auth.uid() = user_id)` }),
	pgPolicy("notifications_update", { as: "permissive", for: "update", to: ["public"] }),
	check("notifications_type_check", sql`type = 'conversation_assigned'::text`),
]);

export const aiKnowledgeDocuments = pgTable("ai_knowledge_documents", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	createdBy: uuid("created_by"),
	title: text().notNull(),
	content: text().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ai_knowledge_documents_account_id_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "ai_knowledge_documents_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "ai_knowledge_documents_created_by_fkey"
		}).onDelete("set null"),
	pgPolicy("ai_knowledge_documents_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("ai_knowledge_documents_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("ai_knowledge_documents_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("ai_knowledge_documents_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const aiConfigs = pgTable("ai_configs", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	createdBy: uuid("created_by"),
	provider: text().notNull(),
	model: text().notNull(),
	apiKey: text("api_key").notNull(),
	systemPrompt: text("system_prompt"),
	isActive: boolean("is_active").default(false).notNull(),
	autoReplyEnabled: boolean("auto_reply_enabled").default(false).notNull(),
	autoReplyMaxPerConversation: integer("auto_reply_max_per_conversation").default(3).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	embeddingsApiKey: text("embeddings_api_key"),
	handoffAgentId: uuid("handoff_agent_id"),
	baseUrl: text("base_url"),
}, (table) => [
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "ai_configs_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "ai_configs_created_by_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.handoffAgentId],
			foreignColumns: [users.id],
			name: "ai_configs_handoff_agent_id_fkey"
		}).onDelete("set null"),
	unique("ai_configs_account_id_key").on(table.accountId),
	pgPolicy("ai_configs_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("ai_configs_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("ai_configs_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("ai_configs_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("ai_configs_auto_reply_max_per_conversation_check", sql`(auto_reply_max_per_conversation >= 1) AND (auto_reply_max_per_conversation <= 20)`),
	check("ai_configs_openai_compatible_base_url_check", sql`(provider <> 'openai_compatible'::text) OR ((base_url IS NOT NULL) AND (btrim(base_url) <> ''::text))`),
	check("ai_configs_provider_check", sql`provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'openai_compatible'::text])`),
]);

export const quickReplies = pgTable("quick_replies", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	userId: uuid("user_id").notNull(),
	title: text().notNull(),
	kind: text().default('text').notNull(),
	contentText: text("content_text"),
	interactivePayload: jsonb("interactive_payload"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_quick_replies_account").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "quick_replies_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "quick_replies_user_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("quick_replies_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("quick_replies_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("quick_replies_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("quick_replies_delete", { as: "permissive", for: "delete", to: ["public"] }),
	check("quick_replies_content_matches_kind", sql`((kind = 'text'::text) AND (content_text IS NOT NULL) AND (btrim(content_text) <> ''::text)) OR ((kind = 'interactive'::text) AND (interactive_payload IS NOT NULL)))) NOT VALID`),
	check("quick_replies_kind_check", sql`kind = ANY (ARRAY['text'::text, 'interactive'::text])`),
]);

export const aiKnowledgeChunks = pgTable("ai_knowledge_chunks", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	documentId: uuid("document_id").notNull(),
	accountId: uuid("account_id").notNull(),
	chunkIndex: integer("chunk_index").default(0).notNull(),
	content: text().notNull(),
	fts: tsvector("fts").generatedAlwaysAs(sql`to_tsvector('simple'::regconfig, content)`),
	embedding: vector({ dimensions: 1536 }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ai_knowledge_chunks_account_id_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("ai_knowledge_chunks_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	index("ai_knowledge_chunks_embedding_idx").using("hnsw", table.embedding.asc().nullsLast().op("vector_cosine_ops")),
	index("ai_knowledge_chunks_fts_idx").using("gin", table.fts.asc().nullsLast().op("tsvector_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "ai_knowledge_chunks_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [aiKnowledgeDocuments.id],
			name: "ai_knowledge_chunks_document_id_fkey"
		}).onDelete("cascade"),
	pgPolicy("ai_knowledge_chunks_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id)` }),
	pgPolicy("ai_knowledge_chunks_insert", { as: "permissive", for: "insert", to: ["public"] }),
	pgPolicy("ai_knowledge_chunks_update", { as: "permissive", for: "update", to: ["public"] }),
	pgPolicy("ai_knowledge_chunks_delete", { as: "permissive", for: "delete", to: ["public"] }),
]);

export const aiUsageLog = pgTable("ai_usage_log", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	conversationId: uuid("conversation_id"),
	mode: text().notNull(),
	provider: text().notNull(),
	model: text().notNull(),
	promptTokens: integer("prompt_tokens").default(0).notNull(),
	completionTokens: integer("completion_tokens").default(0).notNull(),
	totalTokens: integer("total_tokens").default(0).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_ai_usage_log_account_created").using("btree", table.accountId.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "ai_usage_log_account_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.conversationId],
			foreignColumns: [conversations.id],
			name: "ai_usage_log_conversation_id_fkey"
		}).onDelete("set null"),
	pgPolicy("ai_usage_log_select", { as: "permissive", for: "select", to: ["public"], using: sql`is_account_member(account_id, 'admin'::account_role_enum)` }),
	check("ai_usage_log_mode_check", sql`mode = ANY (ARRAY['auto_reply'::text, 'draft'::text])`),
	check("ai_usage_log_provider_check", sql`provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'openai_compatible'::text])`),
]);

export const pendingMessageStatuses = pgTable("pending_message_statuses", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	wamid: text().notNull(),
	status: text().notNull(),
	errorCode: integer("error_code"),
	errorTitle: text("error_title"),
	errorDetails: text("error_details"),
	statusAt: timestamp("status_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_pending_message_statuses_created_at").using("btree", table.createdAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [accounts.id],
			name: "pending_message_statuses_account_id_fkey"
		}).onDelete("cascade"),
	unique("pending_message_statuses_account_wamid_status_key").on(table.accountId, table.wamid, table.status),
]);
