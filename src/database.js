import { supabase } from './supabase.js'

function createOperationError(operation, error) {
  const detail = error?.message || String(error)
  const wrappedError = new Error(`${operation} failed: ${detail}`)

  wrappedError.cause = error
  if (error?.code) wrappedError.code = error.code

  return wrappedError
}

function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.'
    )
  }
}

async function runQuery(operation, request) {
  try {
    const { data, error } = await request()
    if (error) throw error
    return data
  } catch (error) {
    throw createOperationError(operation, error)
  }
}

async function getAuthenticatedUserId(expectedUserId) {
  requireSupabase()

  if (!expectedUserId) {
    throw new Error('A user ID is required for finance data operations.')
  }

  const data = await runQuery(
    'Verify the authenticated user',
    () => supabase.auth.getUser()
  )

  if (!data.user) {
    throw new Error('You must be signed in to access finance data.')
  }

  if (data.user.id !== expectedUserId) {
    throw new Error(
      'The requested user does not match the currently signed-in user.'
    )
  }

  return data.user.id
}

function toPositiveNumber(value, label) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive finite number.`)
  }

  return number
}

function hasOwn(object, property) {
  return Object.prototype.hasOwnProperty.call(object, property)
}

export function transactionFromDatabase(row) {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    category: row.category,
    type: row.type,
    date: row.transaction_date,
    ...(row.recurring_template_id != null && {
      recurringTemplateId: row.recurring_template_id,
    }),
    ...(row.recurring_occurrence_date != null && {
      recurringOccurrenceDate: row.recurring_occurrence_date,
    }),
    ...(row.legacy_recurring_template_id != null && {
      legacyRecurringTemplateId: row.legacy_recurring_template_id,
    }),
  }
}

export function transactionToDatabase(transaction) {
  const row = {
    name: transaction.name,
    amount: toPositiveNumber(transaction.amount, 'Transaction amount'),
    category: transaction.category,
    type: transaction.type,
    transaction_date: transaction.date,
    recurring_template_id: transaction.recurringTemplateId ?? null,
    recurring_occurrence_date: transaction.recurringOccurrenceDate ?? null,
    legacy_recurring_template_id:
      transaction.legacyRecurringTemplateId == null
        ? null
        : String(transaction.legacyRecurringTemplateId),
  }

  if (transaction.id != null) row.id = transaction.id

  return row
}

function transactionUpdatesToDatabase(updates) {
  const row = {}
  const fields = [
    ['name', 'name'],
    ['category', 'category'],
    ['type', 'type'],
    ['date', 'transaction_date'],
    ['recurringTemplateId', 'recurring_template_id'],
    ['recurringOccurrenceDate', 'recurring_occurrence_date'],
    ['legacyRecurringTemplateId', 'legacy_recurring_template_id'],
  ]

  for (const [source, target] of fields) {
    if (!hasOwn(updates, source)) continue
    const value = updates[source]
    row[target] =
      source === 'legacyRecurringTemplateId' && value != null
        ? String(value)
        : value
  }

  if (hasOwn(updates, 'amount')) {
    row.amount = toPositiveNumber(updates.amount, 'Transaction amount')
  }

  if (Object.keys(row).length === 0) {
    throw new Error('Provide at least one transaction field to update.')
  }

  return row
}

export function recurringTemplateFromDatabase(row) {
  return {
    id: row.id,
    name: row.name,
    amount: Number(row.amount),
    category: row.category,
    type: row.type,
    frequency: row.frequency,
    startDate: row.start_date,
    nextDate: row.next_date,
    anchorDay: Number(row.anchor_day),
    active: row.active,
    deletedAt: row.deleted_at,
  }
}

export function recurringTemplateToDatabase(template) {
  const row = {
    name: template.name,
    amount: toPositiveNumber(template.amount, 'Recurring transaction amount'),
    category: template.category,
    type: template.type,
    frequency: template.frequency,
    start_date: template.startDate,
    next_date: template.nextDate,
    anchor_day: Number(template.anchorDay),
    active: template.active ?? true,
  }

  if (
    !Number.isInteger(row.anchor_day) ||
    row.anchor_day < 1 ||
    row.anchor_day > 31
  ) {
    throw new Error(
      'Recurring transaction anchor day must be between 1 and 31.'
    )
  }

  if (template.id != null) row.id = template.id

  return row
}

function recurringTemplateUpdatesToDatabase(updates) {
  const row = {}
  const fields = [
    ['name', 'name'],
    ['category', 'category'],
    ['type', 'type'],
    ['frequency', 'frequency'],
    ['startDate', 'start_date'],
    ['nextDate', 'next_date'],
    ['active', 'active'],
  ]

  for (const [source, target] of fields) {
    if (hasOwn(updates, source)) row[target] = updates[source]
  }

  if (hasOwn(updates, 'amount')) {
    row.amount = toPositiveNumber(
      updates.amount,
      'Recurring transaction amount'
    )
  }

  if (hasOwn(updates, 'anchorDay')) {
    row.anchor_day = Number(updates.anchorDay)
    if (
      !Number.isInteger(row.anchor_day) ||
      row.anchor_day < 1 ||
      row.anchor_day > 31
    ) {
      throw new Error(
        'Recurring transaction anchor day must be between 1 and 31.'
      )
    }
  }

  if (Object.keys(row).length === 0) {
    throw new Error('Provide at least one recurring template field to update.')
  }

  return row
}

function monthKeyToDate(monthKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey)
  if (!match) {
    throw new Error('Savings goal month must use the YYYY-MM format.')
  }

  const month = Number(match[2])
  if (month < 1 || month > 12) {
    throw new Error('Savings goal month must be between 01 and 12.')
  }

  return `${monthKey}-01`
}

export function savingsGoalsFromDatabase(rows) {
  return rows.reduce((goals, row) => {
    const monthStart = String(row.month_start)
    if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(monthStart)) {
      throw new Error(
        `Invalid savings goal month returned by Supabase: ${monthStart}`
      )
    }

    goals[monthStart.slice(0, 7)] = Number(row.target_amount)
    return goals
  }, {})
}

async function fetchTransactionsForUser(userId) {
  const rows = await runQuery('Fetch transactions', () =>
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  )

  return rows.map(transactionFromDatabase)
}

async function fetchRecurringTemplatesForUser(userId) {
  const rows = await runQuery('Fetch recurring templates', () =>
    supabase
      .from('recurring_templates')
      .select('*')
      .eq('user_id', userId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
  )

  return rows.map(recurringTemplateFromDatabase)
}

async function fetchMonthlyBudgetForUser(userId) {
  const row = await runQuery('Fetch monthly budget', () =>
    supabase
      .from('monthly_budget_settings')
      .select('monthly_amount')
      .eq('user_id', userId)
      .maybeSingle()
  )

  return row ? Number(row.monthly_amount) : 0
}

async function fetchMonthlySavingsGoalsForUser(userId) {
  const rows = await runQuery('Fetch monthly savings goals', () =>
    supabase
      .from('monthly_savings_goals')
      .select('month_start, target_amount')
      .eq('user_id', userId)
  )

  return savingsGoalsFromDatabase(rows)
}

export async function fetchFinanceData(userId) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const [
    transactions,
    recurringTemplates,
    monthlyBudget,
    savingsTargets,
  ] = await Promise.all([
    fetchTransactionsForUser(authenticatedUserId),
    fetchRecurringTemplatesForUser(authenticatedUserId),
    fetchMonthlyBudgetForUser(authenticatedUserId),
    fetchMonthlySavingsGoalsForUser(authenticatedUserId),
  ])

  return {
    transactions,
    recurringTemplates,
    monthlyBudget,
    savingsTargets,
  }
}

export async function fetchTransactions(userId) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  return fetchTransactionsForUser(authenticatedUserId)
}

export async function insertTransaction(userId, transaction) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const row = {
    ...transactionToDatabase(transaction),
    user_id: authenticatedUserId,
  }

  try {
    const inserted = await runQuery('Insert transaction', () =>
      supabase.from('transactions').insert(row).select('*').single()
    )
    return transactionFromDatabase(inserted)
  } catch (error) {
    const hasTemplateOccurrence =
      transaction.recurringTemplateId != null &&
      transaction.recurringOccurrenceDate != null
    const hasLegacyOccurrence =
      transaction.legacyRecurringTemplateId != null &&
      transaction.recurringOccurrenceDate != null

    if (
      error.code !== '23505' ||
      (!hasTemplateOccurrence && !hasLegacyOccurrence)
    ) {
      throw error
    }

    const existing = await runQuery(
      'Fetch existing recurring transaction occurrence',
      () => {
        let query = supabase
          .from('transactions')
          .select('*')
          .eq('user_id', authenticatedUserId)

        query = hasTemplateOccurrence
          ? query.eq('recurring_template_id', transaction.recurringTemplateId)
          : query.eq(
              'legacy_recurring_template_id',
              String(transaction.legacyRecurringTemplateId)
            )

        return query
          .eq('recurring_occurrence_date', transaction.recurringOccurrenceDate)
          .maybeSingle()
      }
    )

    if (!existing) throw error
    return transactionFromDatabase(existing)
  }
}

export async function updateTransaction(userId, transactionId, updates) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const row = transactionUpdatesToDatabase(updates)
  const updated = await runQuery('Update transaction', () =>
    supabase
      .from('transactions')
      .update(row)
      .eq('user_id', authenticatedUserId)
      .eq('id', transactionId)
      .select('*')
      .maybeSingle()
  )

  if (!updated) {
    throw new Error(
      'Update transaction failed: no matching transaction was found.'
    )
  }

  return transactionFromDatabase(updated)
}

export async function deleteTransaction(userId, transactionId) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const deleted = await runQuery('Delete transaction', () =>
    supabase
      .from('transactions')
      .delete()
      .eq('user_id', authenticatedUserId)
      .eq('id', transactionId)
      .select('id')
      .maybeSingle()
  )

  if (!deleted) {
    throw new Error(
      'Delete transaction failed: no matching transaction was found.'
    )
  }
}

export async function fetchRecurringTemplates(userId) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  return fetchRecurringTemplatesForUser(authenticatedUserId)
}

export async function insertRecurringTemplate(userId, template) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const row = {
    ...recurringTemplateToDatabase(template),
    user_id: authenticatedUserId,
  }
  const inserted = await runQuery('Insert recurring template', () =>
    supabase.from('recurring_templates').insert(row).select('*').single()
  )

  return recurringTemplateFromDatabase(inserted)
}

export async function updateRecurringTemplate(userId, templateId, updates) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const row = recurringTemplateUpdatesToDatabase(updates)
  const updated = await runQuery('Update recurring template', () =>
    supabase
      .from('recurring_templates')
      .update(row)
      .eq('user_id', authenticatedUserId)
      .eq('id', templateId)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
  )

  if (!updated) {
    throw new Error(
      'Update recurring template failed: no active template was found.'
    )
  }

  return recurringTemplateFromDatabase(updated)
}

export async function softDeleteRecurringTemplate(userId, templateId) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const updated = await runQuery('Soft-delete recurring template', () =>
    supabase
      .from('recurring_templates')
      .update({
        active: false,
        deleted_at: new Date().toISOString(),
      })
      .eq('user_id', authenticatedUserId)
      .eq('id', templateId)
      .is('deleted_at', null)
      .select('*')
      .maybeSingle()
  )

  if (!updated) {
    throw new Error(
      'Soft-delete recurring template failed: no active template was found.'
    )
  }

  return recurringTemplateFromDatabase(updated)
}

export async function fetchMonthlyBudget(userId) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  return fetchMonthlyBudgetForUser(authenticatedUserId)
}

export async function saveMonthlyBudget(userId, monthlyAmount) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const amount = toPositiveNumber(monthlyAmount, 'Monthly budget')
  const row = await runQuery('Save monthly budget', () =>
    supabase
      .from('monthly_budget_settings')
      .upsert(
        {
          user_id: authenticatedUserId,
          monthly_amount: amount,
        },
        { onConflict: 'user_id' }
      )
      .select('monthly_amount')
      .single()
  )

  return Number(row.monthly_amount)
}

export async function fetchMonthlySavingsGoals(userId) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  return fetchMonthlySavingsGoalsForUser(authenticatedUserId)
}

export async function saveMonthlySavingsGoal(userId, monthKey, targetAmount) {
  const authenticatedUserId = await getAuthenticatedUserId(userId)
  const amount = toPositiveNumber(targetAmount, 'Savings goal')
  const row = await runQuery('Save monthly savings goal', () =>
    supabase
      .from('monthly_savings_goals')
      .upsert(
        {
          user_id: authenticatedUserId,
          month_start: monthKeyToDate(monthKey),
          target_amount: amount,
        },
        { onConflict: 'user_id,month_start' }
      )
      .select('month_start, target_amount')
      .single()
  )
  const goals = savingsGoalsFromDatabase([row])

  return {
    monthKey,
    targetAmount: goals[monthKey],
  }
}
