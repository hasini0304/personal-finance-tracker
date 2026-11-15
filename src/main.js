
import './style.css'
import Chart from 'chart.js/auto'
import { supabase } from './supabase.js'
import {
  deleteTransaction as deleteCloudTransaction,
  fetchFinanceData,
  insertRecurringTemplate,
  insertTransaction,
  saveMonthlyBudget,
  saveMonthlySavingsGoal,
  softDeleteRecurringTemplate,
  updateRecurringTemplate,
  updateTransaction,
} from './database.js'

const app = document.querySelector('#app')
let dashboardInitialized = false
let dashboardLoading = false
let dashboardCleanup = null
let recoveringPassword = false
let authStateSubscription = null
let dashboardLoadGeneration = 0
let pendingMigrationChoiceResolver = null
let migrationChoiceMade = false

function showDashboard(user) {
  if (dashboardInitialized || dashboardLoading) return

  dashboardLoading = true
  const loadGeneration = ++dashboardLoadGeneration
  showLoadingScreen('Loading your finance data...')

  initializeDashboard(user, loadGeneration)
    .then((cleanup) => {
      if (loadGeneration !== dashboardLoadGeneration) {
        if (cleanup) cleanup()
        return
      }

      dashboardLoading = false
      dashboardInitialized = true
      dashboardCleanup = cleanup
    })
    .catch((error) => {
      if (loadGeneration !== dashboardLoadGeneration) return

      dashboardLoading = false
      showDashboardLoadError(error, user)
    })
}

function showLoadingScreen(message) {
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-card" aria-live="polite">
        <h1>Pennywise</h1>
        <p>${message}</p>
      </section>
    </main>
  `
}

function showDashboardLoadError(error, user) {
  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-card" aria-live="polite">
        <h1>Pennywise</h1>
        <p id="dashboard-load-error"></p>
        <button id="retry-dashboard-load" type="button">Try again</button>
      </section>
    </main>
  `

  const detail =
    error instanceof Error ? error.message : 'An unexpected error occurred.'
  app.querySelector('#dashboard-load-error').textContent =
    `Could not load your finance data. ${detail}`
  app.querySelector('#retry-dashboard-load').addEventListener('click', () => {
    showDashboard(user)
  })
}

function authErrorMessage(error) {
  const knownMessages = {
    invalid_credentials: 'The email or password is incorrect.',
    email_not_confirmed: 'Please confirm your email before signing in.',
    user_already_exists: 'An account with this email already exists.',
    weak_password: 'Choose a stronger password and try again.',
    over_email_send_rate_limit:
      'Too many emails have been requested. Please wait before trying again.',
  }

  if (error?.code && knownMessages[error.code]) {
    return knownMessages[error.code]
  }

  const errorText = error?.message || ''
  if (/invalid login credentials/i.test(errorText)) {
    return 'The email or password is incorrect.'
  }

  if (/failed to fetch|network/i.test(errorText)) {
    return 'Unable to reach Supabase. Check your connection and project settings.'
  }

  return errorText || 'Authentication failed. Please try again.'
}

function renderAuth(mode = 'login', message = '', messageType = 'error') {
  const titles = {
    login: 'Welcome back',
    register: 'Create your account',
    reset: 'Reset your password',
    'update-password': 'Choose a new password',
  }
  const descriptions = {
    login: 'Sign in to continue to your personal finance dashboard.',
    register: 'Start managing your money with Pennywise.',
    reset: 'Enter your email and we will send you a reset link.',
    'update-password': 'Use a new password for your Pennywise account.',
  }
  const isReset = mode === 'reset'
  const isUpdate = mode === 'update-password'
  const isRegister = mode === 'register'

  app.innerHTML = `
    <main class="auth-page">
      <section class="auth-card">
        <a class="auth-brand" href="/" aria-label="Pennywise home">Pennywise</a>
        <h1>${titles[mode]}</h1>
        <p class="auth-description">${descriptions[mode]}</p>
        <form id="auth-form" class="auth-form">
          ${isUpdate ? '' : `
            <label for="auth-email">Email</label>
            <input
              id="auth-email"
              name="email"
              type="email"
              autocomplete="email"
              maxlength="254"
              required
            >
          `}
          ${isReset ? '' : `
            <label for="auth-password">Password</label>
            <input
              id="auth-password"
              name="password"
              type="password"
              autocomplete="${isUpdate ? 'new-password' : isRegister ? 'new-password' : 'current-password'}"
              ${isRegister || isUpdate ? 'minlength="8"' : ''}
              required
            >
          `}
          ${isUpdate ? `
            <label for="auth-password-confirmation">Confirm new password</label>
            <input
              id="auth-password-confirmation"
              name="passwordConfirmation"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            >
          ` : ''}
          ${isRegister ? `
            <label for="auth-password-confirmation">Confirm password</label>
            <input
              id="auth-password-confirmation"
              name="passwordConfirmation"
              type="password"
              autocomplete="new-password"
              minlength="8"
              required
            >
          ` : ''}
          <button type="submit">
            ${isReset ? 'Send reset link' : isUpdate ? 'Save new password' : isRegister ? 'Create account' : 'Sign in'}
          </button>
          <p id="auth-message" class="auth-message ${messageType}" role="status" aria-live="polite"></p>
        </form>
        <div class="auth-links">
          ${isUpdate ? '' : isReset
    ? '<button class="auth-link" type="button" data-auth-mode="login">Back to sign in</button>'
    : isRegister
      ? '<span>Already have an account?</span><button class="auth-link" type="button" data-auth-mode="login">Sign in</button>'
      : '<button class="auth-link" type="button" data-auth-mode="register">Create account</button><button class="auth-link" type="button" data-auth-mode="reset">Forgot password?</button>'}
        </div>
      </section>
    </main>
  `

  const messageElement = app.querySelector('#auth-message')
  messageElement.textContent = message

  app.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.addEventListener('click', () => renderAuth(button.dataset.authMode))
  })

  const form = app.querySelector('#auth-form')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const formData = new FormData(form)
    const email = String(formData.get('email') || '').trim()
    const password = String(formData.get('password') || '')
    const submitButton = form.querySelector('button[type="submit"]')
    const messageElement = app.querySelector('#auth-message')
    const originalLabel = submitButton.textContent.trim()

    if ((isRegister || isUpdate) && password.length < 8) {
      messageElement.textContent = 'Your password must be at least 8 characters.'
      messageElement.className = 'auth-message error'
      return
    }

    if (
      (isRegister || isUpdate) &&
      password !== String(formData.get('passwordConfirmation') || '')
    ) {
      messageElement.textContent = 'The passwords do not match.'
      messageElement.className = 'auth-message error'
      return
    }

    submitButton.disabled = true
    submitButton.textContent = 'Please wait...'
    messageElement.textContent = ''

    try {
      let result
      if (mode === 'login') {
        result = await supabase.auth.signInWithPassword({ email, password })
      } else if (isRegister) {
        result = await supabase.auth.signUp({ email, password })
      } else if (isReset) {
        result = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        })
      } else {
        result = await supabase.auth.updateUser({ password })
      }

      if (result.error) throw result.error

      if (isRegister) {
        const hasSession = Boolean(result.data?.session)
        if (!hasSession) {
          messageElement.textContent =
            'Account created. Check your email to confirm your address, then sign in.'
          messageElement.className = 'auth-message success'
        }
      } else if (isReset) {
        messageElement.textContent =
          'If an account exists for that email, a password reset link is on its way.'
        messageElement.className = 'auth-message success'
      } else if (isUpdate) {
        recoveringPassword = false
        if (result.data?.user) showDashboard(result.data.user)
      } else if (!result.data?.session) {
        messageElement.textContent = 'Sign in did not create an active session. Please try again.'
        messageElement.className = 'auth-message error'
      }
    } catch (error) {
      messageElement.textContent = authErrorMessage(error)
      messageElement.className = 'auth-message error'
    } finally {
      if (submitButton.isConnected) {
        submitButton.disabled = false
        submitButton.textContent = originalLabel
      }
    }
  })
}

function handleAuthStateChange(event, session) {
  if (event === 'PASSWORD_RECOVERY') {
    recoveringPassword = true
    renderAuth('update-password')
    return
  }

  if (session) {
    if (!recoveringPassword) showDashboard(session.user)
    return
  }

  if (event === 'SIGNED_OUT') {
    dashboardLoadGeneration += 1
    dashboardLoading = false
    migrationChoiceMade = false
    if (pendingMigrationChoiceResolver) {
      pendingMigrationChoiceResolver(null)
      pendingMigrationChoiceResolver = null
    }
    if (dashboardCleanup) dashboardCleanup()
    dashboardCleanup = null
    dashboardInitialized = false
    recoveringPassword = false
    renderAuth('login')
  }
}

async function startAuthentication() {
  if (!supabase) {
    showLoadingScreen(
      'Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to your local .env file, then restart Vite.'
    )
    return
  }

  const recoveryRequested =
    new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
  recoveringPassword = recoveryRequested
  if (!authStateSubscription) {
    authStateSubscription =
      supabase.auth.onAuthStateChange(handleAuthStateChange).data.subscription
  }

  showLoadingScreen('Checking your sign-in...')

  let session
  let sessionErrorMessage = ''
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error) throw error
    session = data.session
  } catch (error) {
    sessionErrorMessage =
      `Could not check your session. ${authErrorMessage(error)}`
  }

  if (recoveryRequested && session) {
    recoveringPassword = true
    renderAuth('update-password')
  } else if (recoveryRequested && !sessionErrorMessage) {
    recoveringPassword = false
    renderAuth(
      'login',
      'This password reset link is invalid or expired. Request a new one.',
      'error'
    )
  } else if (recoveryRequested) {
    recoveringPassword = false
    renderAuth('login', sessionErrorMessage)
  } else if (session) {
    showDashboard(session.user)
  } else if (!dashboardInitialized) {
    renderAuth('login', sessionErrorMessage)
  }
}

startAuthentication()

async function initializeDashboard(user, loadGeneration) {
migrationChoiceMade = false
const financeData = await fetchFinanceData(user.id)
if (loadGeneration !== dashboardLoadGeneration) return null
const {
  data: cloudBudgetRow,
  error: cloudBudgetError,
} = await supabase
  .from('monthly_budget_settings')
  .select('user_id')
  .eq('user_id', user.id)
  .maybeSingle()
if (cloudBudgetError) {
  throw new Error(`Could not check the cloud budget record. ${cloudBudgetError.message}`)
}
if (loadGeneration !== dashboardLoadGeneration) return null
const legacyFinanceData = inspectLegacyFinanceData()

let savedTheme = null
try {
  savedTheme = localStorage.getItem('pennywiseTheme')
} catch (error) {
  console.warn('Could not read the saved theme preference.', error)
}
document.documentElement.dataset.theme =
  savedTheme === 'dark' ? 'dark' : 'light'

let transactions = financeData.transactions
let recurringTransactions = financeData.recurringTemplates

app.innerHTML = `
  <header class="topbar">
  <div class="brand">
    <h1>Pennywise</h1>
    <span>Personal Finance Tracker</span>
  </div>

  <nav class="navbar">
    <a href="#dashboard">Dashboard</a>
    <a href="#analytics">Analytics</a>
    <a href="#transactions">Transactions</a>
    <a href="#recurring-transactions">Recurring</a>
    <button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false">
      Dark mode
    </button>
    <div class="user-profile">
      <div>
        <span id="profile-email"></span>
        <p id="logout-message" class="auth-message" role="status" aria-live="polite"></p>
      </div>
      <button id="logout-button" class="logout-button" type="button">Log out</button>
    </div>
  </nav>
</header>

  <main class="container" id="dashboard">
    <section class="welcome">
      <div>
        <p class="eyebrow">YOUR MONEY, YOUR CONTROL</p>
        <h2>Good day!</h2>
        <p>Here's how your money is looking.</p>
      </div>
      <label class="month-filter">
  Month
  <input id="month-filter" type="month">
</label>
    </section>

    <section class="summary">

      <article class="summary-card">
        <p>Total balance</p>
        <h2 id="balance">₹0</h2>
      </article>
      <article class="summary-card">
        <p>Total income</p>
        <h2 id="income">₹0</h2>
      </article>
      <article class="summary-card">
        <p>Total expenses</p>
        <h2 id="expenses">₹0</h2>
      </article>
      </section>
      <section class="panel financial-insights">
        <h2>Monthly Financial Insights</h2>
        <div class="insights-grid">
          <article class="insight-card">
            <p>Highest Spending Category</p>
            <h3 id="highest-spending-category">No expenses yet</h3>
            <span id="highest-spending-amount">${formatMoney(0)}</span>
          </article>
          <article class="insight-card">
            <p>Average Daily Spending</p>
            <h3 id="average-daily-spending">${formatMoney(0)}</h3>
          </article>
          <article class="insight-card">
            <p>Savings Rate</p>
            <h3 id="savings-rate">N/A</h3>
          </article>
          <article class="insight-card insight-summary">
            <p>Monthly Financial Summary</p>
            <h3 id="monthly-financial-summary">No transaction data for this month.</h3>
          </article>
        </div>
      </section>
      <section class="panel savings-goal">
  <h2>My Savings Goal</h2>
  <p>Set a savings target for this month.</p>

  <div class="savings-input">
    <input
      type="number"
      id="savings-target"
      placeholder="Enter savings target (₹)"
      min="1"
    />

    <button type="button" id="save-savings-goal">
      Save Goal
    </button>
  </div>

  <h3 id="savings-amount">₹0 saved</h3>

  <div class="savings-progress-container">
    <div id="savings-progress-bar"></div>
  </div>

  <p id="savings-message">Set a savings goal to get started.</p>
</section>

      <section class="analytics-grid" id="analytics">
      <section class="panel analytics">
  <h2>Monthly Expenses</h2>
  <p class="chart-subtitle">Your spending over the last 6 months</p>

  <div class="chart-container">
    <canvas id="monthly-expense-chart"></canvas>
  </div>

</section>
 <section class="panel analytics">
      <h2>Category-wise Spending</h2>
       <p class="chart-subtitle">See where your money goes in the selected month</p>

      <div class="chart-container">
        <canvas id="category-expense-chart"></canvas>
      </div>
    </section>
    <section class="panel analytics">
  <h2>Income vs Expenses</h2>
  <p class="chart-subtitle">
    Compare your income and spending over the last 6 months
  </p>

  <div class="chart-container">
    <canvas id="income-expense-chart"></canvas>
  </div>
</section>
      </section>

    <section class="content">
      <form id="transaction-form" class="panel">
        <h2>Add a transaction</h2>

        <label for="name">Description</label>
        <input id="name" type="text" placeholder="e.g. Groceries" required>

        <label for="amount">Amount (₹)</label>
        <input id="amount" type="number" min="0.01" step="0.01" placeholder="e.g. 250" required>

        <label for="type">Transaction type</label>
        <select id="type">
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>

        <label for="category">Category</label>
        <select id="category">
          <option>Food</option>
          <option>Travel</option>
          <option>Education</option>
          <option>Shopping</option>
          <option>Bills</option>
          <option>Other</option>
          <option>Income</option>
        </select>

        <label for="date">Date</label>
        <input id="date" type="date" required>

        <button type="submit">Add transaction</button>
        <p id="transaction-message" class="transaction-message" role="status" aria-live="polite"></p>
      </form>

     <section class="panel transactions" id="transactions">
  <h2>Recent transactions</h2>

  <div class="transaction-controls">
    <input
      id="search-input"
      type="search"
      placeholder="Search transactions..."
    >

    <select id="category-filter">
      <option value="all">All categories</option>
      <option value="Food">Food</option>
      <option value="Travel">Travel</option>
      <option value="Education">Education</option>
      <option value="Shopping">Shopping</option>
      <option value="Bills">Bills</option>
      <option value="Other">Other</option>
       <option value="Income">Income</option>
    </select>
    <select id="type-filter">
  <option value="all">All types</option>
  <option value="income">Income</option>
  <option value="expense">Expense</option>
</select>
<button type="button" id="export-csv" class="csv-button">
  Export CSV
</button>
<button type="button" id="import-csv" class="csv-button">
  Import CSV
</button>
<input id="import-csv-input" type="file" accept=".csv,text/csv" hidden>
<p id="import-message" class="import-message" role="status" aria-live="polite"></p>
</div>
<section class="budget-section">
  <h2>Monthly Budget</h2>

  <div class="budget-input">
    <input
      type="number"
      id="monthly-budget"
      placeholder="Enter monthly budget (₹)"
      min="1"
    />

    <button type="button" id="save-budget">
      Save Budget
    </button>
  </div>

  <p id="budget-message">Set your monthly budget to get started.</p>
  <div class="budget-progress-container">
  <div id="budget-progress-bar"></div>
</div>

<p id="budget-percentage">0% used</p>
</section>

  <div id="transaction-list"></div>
</section>
    </section>
    <section class="panel recurring-panel" id="recurring-transactions">
      <h2>Recurring Transactions</h2>
      <div class="recurring-layout">
        <form id="recurring-form" class="recurring-form">
          <h3>Add Recurring Transaction</h3>

          <label for="recurring-name">Description</label>
          <input id="recurring-name" type="text" placeholder="e.g. Monthly rent" required>

          <label for="recurring-amount">Amount (₹)</label>
          <input id="recurring-amount" type="number" min="0.01" step="0.01" required>

          <label for="recurring-category">Category</label>
          <select id="recurring-category" required>
            <option value="Food">Food</option>
            <option value="Travel">Travel</option>
            <option value="Education">Education</option>
            <option value="Shopping">Shopping</option>
            <option value="Bills">Bills</option>
            <option value="Other">Other</option>
            <option value="Income">Income</option>
          </select>

          <label for="recurring-type">Type</label>
          <select id="recurring-type" required>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>

          <label for="recurring-frequency">Frequency</label>
          <select id="recurring-frequency" required>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>

          <label for="recurring-start-date">Start date</label>
          <input id="recurring-start-date" type="date" required>

          <button type="submit">Add Recurring Transaction</button>
        </form>

        <section class="recurring-management">
          <h3>Saved recurring transactions</h3>
          <div id="recurring-list"></div>
        </section>
      </div>
      <p id="recurring-message" class="recurring-message" role="status" aria-live="polite"></p>
    </section>
  </main>
`

const form = document.querySelector('#transaction-form')
const transactionMessage = document.querySelector('#transaction-message')
const recurringForm = document.querySelector('#recurring-form')
const recurringStartDateInput =
  document.querySelector('#recurring-start-date')
const recurringList = document.querySelector('#recurring-list')
const recurringMessage = document.querySelector('#recurring-message')
const list = document.querySelector('#transaction-list')
let monthlyExpenseChart = null
let categoryExpenseChart = null
let incomeExpenseChart = null
const monthFilter = document.querySelector('#month-filter')
const searchInput = document.querySelector('#search-input')
const categoryFilter = document.querySelector('#category-filter')
const typeFilter = document.querySelector('#type-filter')
const themeToggle = document.querySelector('#theme-toggle')
const profileEmail = document.querySelector('#profile-email')
const logoutButton = document.querySelector('#logout-button')
const logoutMessage = document.querySelector('#logout-message')
const exportButton = document.querySelector('#export-csv')
const importButton = document.querySelector('#import-csv')
const importCsvInput = document.querySelector('#import-csv-input')
const importMessage = document.querySelector('#import-message')
const monthlyBudgetInput = document.querySelector('#monthly-budget')
const saveBudgetButton = document.querySelector('#save-budget')
const budgetMessage = document.querySelector('#budget-message')
const savingsTargetInput = document.querySelector('#savings-target')
const saveSavingsButton = document.querySelector('#save-savings-goal')
const savingsAmount = document.querySelector('#savings-amount')
const savingsProgressBar = document.querySelector('#savings-progress-bar')
const savingsMessage = document.querySelector('#savings-message')
const highestSpendingCategory =
  document.querySelector('#highest-spending-category')
const highestSpendingAmount =
  document.querySelector('#highest-spending-amount')
const averageDailySpending =
  document.querySelector('#average-daily-spending')
const savingsRate = document.querySelector('#savings-rate')
const monthlyFinancialSummary =
  document.querySelector('#monthly-financial-summary')

profileEmail.textContent = user.email || 'Signed in'
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true
  logoutMessage.textContent = ''

  try {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  } catch (error) {
    logoutMessage.textContent = authErrorMessage(error)
    logoutMessage.className = 'auth-message error'
  } finally {
    if (logoutButton.isConnected) logoutButton.disabled = false
  }
})

let savingsTargets = financeData.savingsTargets

saveSavingsButton.addEventListener('click', async () => {
  const enteredTarget = Number(savingsTargetInput.value)

  if (!Number.isFinite(enteredTarget) || enteredTarget <= 0) {
    savingsMessage.textContent = 'Please enter a valid savings target.'
    return
  }

  const selectedMonth = monthFilter.value
  saveSavingsButton.disabled = true

  try {
    const savedGoal = await saveMonthlySavingsGoal(
      user.id,
      selectedMonth,
      enteredTarget
    )
    savingsTargets[selectedMonth] = savedGoal.targetAmount
    updateSavingsGoalDisplay()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    savingsMessage.textContent = `Savings goal could not be saved. ${detail}`
  } finally {
    if (saveSavingsButton.isConnected) saveSavingsButton.disabled = false
  }
})

let monthlyBudget = financeData.monthlyBudget

monthlyBudgetInput.value = monthlyBudget || ''

exportButton.addEventListener('click', exportTransactions)
importButton.addEventListener('click', () => importCsvInput.click())
importCsvInput.addEventListener('change', importTransactions)
themeToggle.addEventListener('click', () => {
  const nextTheme =
    document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  applyTheme(nextTheme, true)
})
saveBudgetButton.addEventListener('click', async () => {
  const enteredBudget = Number(monthlyBudgetInput.value)

  if (!Number.isFinite(enteredBudget) || enteredBudget <= 0) {
    budgetMessage.textContent = 'Please enter a valid budget.'
    return
  }

  saveBudgetButton.disabled = true

  try {
    monthlyBudget = await saveMonthlyBudget(user.id, enteredBudget)
    updateBudgetDisplay()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    budgetMessage.textContent = `Budget could not be saved. ${detail}`
  } finally {
    if (saveBudgetButton.isConnected) saveBudgetButton.disabled = false
  }
})
let editingTransactionId = null

const today = new Date()
const currentMonth =
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

recurringStartDateInput.value =
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

monthFilter.value = currentMonth

savingsTargetInput.value = savingsTargets[currentMonth] || ''

monthFilter.addEventListener('change', () => {
  savingsTargetInput.value = savingsTargets[monthFilter.value] || ''
  renderTransactions()
})
searchInput.addEventListener('input', renderTransactions)
categoryFilter.addEventListener('change', renderTransactions)
typeFilter.addEventListener('change', renderTransactions)
recurringForm.addEventListener('submit', addRecurringTransaction)
applyTheme(document.documentElement.dataset.theme, false)

function getVisibleTransactions() {
  const searchText = searchInput.value.trim().toLowerCase()
  const selectedCategory = categoryFilter.value
  const selectedType = typeFilter.value

  return transactions.filter((item) => {
    const matchesMonth = item.date.startsWith(monthFilter.value)

    const matchesSearch =
      item.name.toLowerCase().includes(searchText) ||
      item.category.toLowerCase().includes(searchText)

    const matchesCategory =
      selectedCategory === 'all' ||
      item.category === selectedCategory

    const matchesType =
      selectedType === 'all' || item.type === selectedType

    return matchesMonth && matchesSearch && matchesCategory && matchesType
  })
}

document.querySelector('#date').value = formatLocalDate(new Date())

function formatMoney(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}

function updateChartTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark'
  const textColor = isDark ? '#e2e8f0' : '#475569'
  const gridColor = isDark
    ? 'rgba(148, 163, 184, 0.18)'
    : 'rgba(148, 163, 184, 0.24)'

  Chart.defaults.color = textColor

  const charts = [
    monthlyExpenseChart,
    categoryExpenseChart,
    incomeExpenseChart
  ]
  charts.filter(Boolean).forEach((chart) => {
    chart.options.color = textColor
    Object.values(chart.options.scales || {}).forEach((scale) => {
      scale.ticks.color = textColor
      scale.grid.color = gridColor
    })
    if (chart.options.plugins.legend) {
      chart.options.plugins.legend.labels.color = textColor
    }
    chart.update('none')
  })
}

function applyTheme(theme, persist) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light'
  document.documentElement.dataset.theme = nextTheme
  themeToggle.textContent = nextTheme === 'dark' ? 'Light mode' : 'Dark mode'
  themeToggle.setAttribute('aria-pressed', String(nextTheme === 'dark'))
  themeToggle.setAttribute(
    'aria-label',
    `Switch to ${nextTheme === 'dark' ? 'light' : 'dark'} mode`
  )

  if (persist) {
    try {
      localStorage.setItem('pennywiseTheme', nextTheme)
    } catch (error) {
      console.error('Theme changed but could not be saved to LocalStorage.', error)
    }
  }

  updateChartTheme()
}

function prependTransactions(existingTransactions, newTransactions) {
  const knownIds = new Set(existingTransactions.map((transaction) => transaction.id))
  const uniqueNewTransactions = []

  newTransactions.forEach((transaction) => {
    if (knownIds.has(transaction.id)) return
    knownIds.add(transaction.id)
    uniqueNewTransactions.push(transaction)
  })

  return [...uniqueNewTransactions, ...existingTransactions]
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseRecurringDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(0)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCFullYear(year, month - 1, day)
  return date
}

function formatRecurringDate(date) {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function getNextRecurringDate(dateValue, frequency, anchorDay) {
  const date = parseRecurringDate(dateValue)

  if (frequency === 'weekly') {
    date.setUTCDate(date.getUTCDate() + 7)
  } else {
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + 1)

    const lastDayOfMonth = new Date(0)
    lastDayOfMonth.setUTCHours(0, 0, 0, 0)
    lastDayOfMonth.setUTCFullYear(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      0
    )
    date.setUTCDate(Math.min(anchorDay, lastDayOfMonth.getUTCDate()))
  }

  return formatRecurringDate(date)
}

function showRecurringMessage(message, status = 'success') {
  recurringMessage.textContent = message
  recurringMessage.className = `recurring-message ${status}`
}

function showTransactionMessage(message, status = 'success') {
  transactionMessage.textContent = message
  transactionMessage.className = `transaction-message ${status}`
}

async function processDueRecurringTransactions() {
  if (!migrationChoiceMade) return

  const todayDate = formatLocalDate(new Date())
  const updatedTemplates = recurringTransactions.map((template) => ({
    ...template
  }))
  const generatedCandidates = []
  const existingOccurrences = new Set(
    transactions
      .filter((item) => item.recurringTemplateId && item.recurringOccurrenceDate)
      .map((item) =>
        JSON.stringify([item.recurringTemplateId, item.recurringOccurrenceDate])
      )
  )
  let schedulesChanged = false

  for (const template of updatedTemplates) {
    if (
      template.active === false ||
      !isValidTransactionDate(template.startDate) ||
      !['weekly', 'monthly'].includes(template.frequency)
    ) {
      continue
    }

    let nextDate = template.nextDate
    if (!isValidTransactionDate(nextDate) || nextDate < template.startDate) {
      nextDate = template.startDate
      schedulesChanged = true
    }

    const startDay = Number(template.startDate.slice(-2))
    const anchorDay = Math.min(
      31,
      Math.max(1, Number(template.anchorDay) || startDay)
    )

    while (nextDate <= todayDate) {
      const occurrenceKey =
        JSON.stringify([template.id, nextDate])

      if (!existingOccurrences.has(occurrenceKey)) {
        generatedCandidates.push({
          id: crypto.randomUUID(),
          name: template.name,
          amount: Number(template.amount),
          category: template.category,
          type: template.type,
          date: nextDate,
          recurringTemplateId: template.id,
          recurringOccurrenceDate: nextDate
        })
        existingOccurrences.add(occurrenceKey)
      }

      nextDate = getNextRecurringDate(
        nextDate,
        template.frequency,
        anchorDay
      )
      schedulesChanged = true
    }

    template.nextDate = nextDate
  }

  if (!schedulesChanged && generatedCandidates.length === 0) return

  const savedTransactions = []
  for (const transaction of generatedCandidates) {
    try {
      savedTransactions.push(await insertTransaction(user.id, transaction))
    } catch (error) {
      transactions = prependTransactions(transactions, savedTransactions)
      const detail = error instanceof Error ? error.message : String(error)
      showRecurringMessage(
        `Due transactions could not be saved. ${detail}`,
        'error'
      )
      return
    }
  }

  transactions = prependTransactions(transactions, savedTransactions)

  if (schedulesChanged) {
    const previousTemplates = new Map(
      recurringTransactions.map((template) => [template.id, template])
    )
    const templatesToUpdate = updatedTemplates.filter(
      (template) =>
        template.nextDate !== previousTemplates.get(template.id)?.nextDate
    )
    recurringTransactions = updatedTemplates

    for (const template of templatesToUpdate) {
      try {
        await updateRecurringTemplate(user.id, template.id, {
          nextDate: template.nextDate,
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
          showRecurringMessage(
            `Transactions were saved, but recurring schedules could not be updated. ${detail}`,
            'error'
          )
        break
      }
    }
  }
}

async function addRecurringTransaction(event) {
  event.preventDefault()

  const name = document.querySelector('#recurring-name').value.trim()
  const amount = Number(document.querySelector('#recurring-amount').value)
  const category = document.querySelector('#recurring-category').value
  const type = document.querySelector('#recurring-type').value
  const frequency = document.querySelector('#recurring-frequency').value
  const startDate = recurringStartDateInput.value

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !category ||
    !['income', 'expense'].includes(type) ||
    !['weekly', 'monthly'].includes(frequency) ||
    !isValidTransactionDate(startDate)
  ) {
    showRecurringMessage('Enter a valid description, amount, category, type, frequency, and start date.', 'error')
    return
  }

  const template = {
    id: crypto.randomUUID(),
    name,
    amount,
    category,
    type,
    frequency,
    startDate,
    nextDate: startDate,
    anchorDay: Number(startDate.slice(-2)),
    active: true
  }
  try {
    const savedTemplate = await insertRecurringTemplate(user.id, template)
    recurringTransactions = [savedTemplate, ...recurringTransactions]
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showRecurringMessage(`Recurring transaction could not be saved. ${detail}`, 'error')
    return
  }

  recurringForm.reset()
  recurringStartDateInput.value = formatLocalDate(new Date())
  showRecurringMessage('Recurring transaction added.')
  await processDueRecurringTransactions()
  renderRecurringTransactions()
  renderTransactions()
}

async function toggleRecurringTransaction(id) {
  const template = recurringTransactions.find((item) => item.id === id)
  if (!template) return

  const resuming = template.active === false
  const todayDate = formatLocalDate(new Date())
  let nextDate = template.nextDate || template.startDate
  if (resuming) {
    const startDay = Number(template.startDate.slice(-2))
    const anchorDay = Math.min(
      31,
      Math.max(1, Number(template.anchorDay) || startDay)
    )

    if (nextDate < template.startDate) nextDate = template.startDate
    while (nextDate <= todayDate) {
      nextDate = getNextRecurringDate(
        nextDate,
        template.frequency,
        anchorDay
      )
    }
  }

  try {
    const updatedTemplate = await updateRecurringTemplate(user.id, id, {
      active: resuming,
      nextDate,
    })
    recurringTransactions = recurringTransactions.map((item) =>
      item.id === id ? updatedTemplate : item
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showRecurringMessage(`Recurring transaction could not be updated. ${detail}`, 'error')
    return
  }

  renderRecurringTransactions()
  showRecurringMessage(
    resuming
      ? 'Recurring transaction resumed. Missed occurrences while paused were skipped.'
      : 'Recurring transaction paused.'
  )
}

async function deleteRecurringTransaction(id) {
  try {
    await softDeleteRecurringTemplate(user.id, id)
    recurringTransactions = recurringTransactions.filter(
      (item) => item.id !== id
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showRecurringMessage(`Recurring template could not be deleted. ${detail}`, 'error')
    return
  }

  renderRecurringTransactions()
  showRecurringMessage('Recurring template deleted. Existing transactions were kept.')
}

function renderRecurringTransactions() {
  recurringList.innerHTML = ''

  if (recurringTransactions.length === 0) {
    const emptyMessage = document.createElement('p')
    emptyMessage.className = 'empty-state'
    emptyMessage.textContent = 'No recurring transactions yet.'
    recurringList.append(emptyMessage)
    return
  }

  recurringTransactions.forEach((template) => {
    const item = document.createElement('article')
    item.className = 'recurring-item'

    const details = document.createElement('div')
    const name = document.createElement('h4')
    name.textContent = template.name

    const summary = document.createElement('p')
    const frequency =
      template.frequency === 'weekly' ? 'Weekly' : 'Monthly'
    const type = template.type === 'income' ? 'Income' : 'Expense'
    summary.textContent =
      `${formatMoney(Number(template.amount))} · ${type} · ${template.category}`

    const schedule = document.createElement('p')
    schedule.textContent =
      `${frequency} · Next scheduled: ${template.nextDate || template.startDate}`

    const status = document.createElement('span')
    const isActive = template.active !== false
    status.className =
      `recurring-status ${isActive ? 'active' : 'paused'}`
    status.textContent = isActive ? 'Active' : 'Paused'

    details.append(name, summary, schedule, status)

    const actions = document.createElement('div')
    actions.className = 'recurring-actions'

    const toggleButton = document.createElement('button')
    toggleButton.type = 'button'
    toggleButton.className = 'recurring-toggle-btn'
    toggleButton.textContent = isActive ? 'Pause' : 'Resume'
    toggleButton.addEventListener('click', () =>
      toggleRecurringTransaction(template.id)
    )

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'recurring-delete-btn'
    deleteButton.textContent = 'Delete'
    deleteButton.addEventListener('click', () =>
      deleteRecurringTransaction(template.id)
    )

    actions.append(toggleButton, deleteButton)
    item.append(details, actions)
    recurringList.append(item)
  })
}

function updateBudgetDisplay() {
  const progressBar = document.querySelector('#budget-progress-bar')
  const percentageText = document.querySelector('#budget-percentage')

  if (monthlyBudget <= 0) {
    budgetMessage.textContent = 'Set your monthly budget to get started.'
    progressBar.style.width = '0%'
    percentageText.textContent = '0% used'
    return
  }

  const selectedMonth = monthFilter.value

  const monthlyExpenses = transactions
    .filter((item) =>
      item.type === 'expense' &&
      item.date.startsWith(selectedMonth)
    )
    .reduce((total, item) => total + Number(item.amount), 0)

  const remaining = monthlyBudget - monthlyExpenses

  const percentage = (monthlyExpenses / monthlyBudget) * 100

  const progress = Math.min(percentage, 100)

  progressBar.style.width = `${progress}%`

  percentageText.textContent =
    `${percentage.toFixed(1)}% used`

  if (percentage >= 100) {
    progressBar.style.backgroundColor = '#ef4444'
  } else if (percentage >= 80) {
    progressBar.style.backgroundColor = '#f59e0b'
  } else {
    progressBar.style.backgroundColor = '#16a34a'
  }

  budgetMessage.textContent =
    `Budget: ${formatMoney(monthlyBudget)} | ` +
    `Spent: ${formatMoney(monthlyExpenses)} | ` +
    `Remaining: ${formatMoney(remaining)}`
}
function updateSavingsGoalDisplay() {
  const selectedMonth = monthFilter.value

  const savingsTarget = Number(savingsTargets[selectedMonth]) || 0

  if (savingsTarget <= 0) {
    savingsMessage.textContent = 'Set a savings goal to get started.'
    savingsAmount.textContent = '₹0 saved'
    savingsProgressBar.style.width = '0%'
    return
  }

  const monthlyIncome = transactions
    .filter((item) =>
      item.type === 'income' &&
      item.date.startsWith(selectedMonth)
    )
    .reduce((total, item) => total + Number(item.amount), 0)

  const monthlyExpenses = transactions
    .filter((item) =>
      item.type === 'expense' &&
      item.date.startsWith(selectedMonth)
    )
    .reduce((total, item) => total + Number(item.amount), 0)

  const savings = monthlyIncome - monthlyExpenses

  const percentage = Math.min(
    100,
    Math.max(0, (savings / savingsTarget) * 100)
  )

  savingsAmount.textContent = `${formatMoney(savings)} saved`

  savingsProgressBar.style.width = `${percentage}%`

  savingsMessage.textContent =
    `${percentage.toFixed(1)}% of your savings goal completed.`
}

function updateMonthlyFinancialInsights() {
  const selectedMonth = monthFilter.value
  const monthlyTransactions = transactions.filter((item) =>
    item.date.startsWith(selectedMonth)
  )

  const monthlyIncome = monthlyTransactions
    .filter((item) => item.type === 'income')
    .reduce((total, item) => total + Number(item.amount), 0)

  const monthlyExpenses = monthlyTransactions
    .filter((item) => item.type === 'expense')
    .reduce((total, item) => total + Number(item.amount), 0)

  const expensesByCategory = monthlyTransactions
    .filter((item) => item.type === 'expense')
    .reduce((totals, item) => {
      totals[item.category] = (totals[item.category] || 0) +
        Number(item.amount)
      return totals
    }, {})
  const highestCategory = Object.entries(expensesByCategory)
    .sort(([, firstAmount], [, secondAmount]) =>
      secondAmount - firstAmount
    )[0]

  if (highestCategory) {
    highestSpendingCategory.textContent = highestCategory[0]
    highestSpendingAmount.textContent = formatMoney(highestCategory[1])
  } else {
    highestSpendingCategory.textContent = 'No expenses yet'
    highestSpendingAmount.textContent = formatMoney(0)
  }

  const [year, month] = selectedMonth.split('-').map(Number)
  const daysInMonth = new Date(year, month, 0).getDate()
  const daysElapsed =
    selectedMonth === currentMonth ? today.getDate() : daysInMonth

  averageDailySpending.textContent = formatMoney(
    daysElapsed > 0 ? monthlyExpenses / daysElapsed : 0
  )

  savingsRate.textContent = monthlyIncome > 0
    ? `${(((monthlyIncome - monthlyExpenses) / monthlyIncome) * 100).toFixed(1)}%`
    : 'N/A'

  if (monthlyTransactions.length === 0) {
    monthlyFinancialSummary.textContent =
      'No transaction data for this month.'
  } else if (monthlyExpenses > monthlyIncome) {
    monthlyFinancialSummary.textContent =
      `Expenses are higher than income by ${formatMoney(monthlyExpenses - monthlyIncome)}.`
  } else if (monthlyIncome > monthlyExpenses) {
    monthlyFinancialSummary.textContent =
      `You have a positive balance of ${formatMoney(monthlyIncome - monthlyExpenses)} this month.`
  } else {
    monthlyFinancialSummary.textContent =
      'Your income and expenses are balanced this month.'
  }
}

function exportTransactions() {
  if (transactions.length === 0) {
    alert('No transactions to export!')
    return
  }

  const headers = [
    'Description',
    'Category',
    'Amount',
    'Type',
    'Date'
  ]

  const rows = transactions.map((item) => [
    item.name,
    item.category,
    item.amount,
    item.type,
    item.date
  ])

  const csvContent = [
    headers,
    ...rows
  ]
    .map((row) =>
      row.map((value) =>
        `"${String(value).replace(/"/g, '""')}"`
      ).join(',')
    )
    .join('\n')

  const blob = new Blob(
    ['\uFEFF' + csvContent],
    { type: 'text/csv;charset=utf-8;' }
  )

  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = 'pennywise-transactions.csv'

  link.click()

  URL.revokeObjectURL(url)
}

function parseCSV(csvContent) {
  const rows = []
  let row = []
  let field = ''
  let insideQuotes = false
  let quoteClosed = false

  const finishField = () => {
    row.push(field)
    field = ''
    quoteClosed = false
  }

  const finishRow = () => {
    finishField()
    rows.push(row)
    row = []
  }

  for (let index = 0; index < csvContent.length; index += 1) {
    const character = csvContent[index]

    if (insideQuotes) {
      if (character === '"') {
        if (csvContent[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          insideQuotes = false
          quoteClosed = true
        }
      } else {
        field += character
      }
      continue
    }

    if (quoteClosed) {
      if (character === ',') {
        finishField()
      } else if (character === '\n' || character === '\r') {
        finishRow()
        if (character === '\r' && csvContent[index + 1] === '\n') {
          index += 1
        }
      } else if (character !== ' ' && character !== '\t') {
        throw new Error('Unexpected text after a quoted CSV field.')
      }
      continue
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error('A quoted CSV field must start at the beginning of a cell.')
      }
      insideQuotes = true
    } else if (character === ',') {
      finishField()
    } else if (character === '\n' || character === '\r') {
      finishRow()
      if (character === '\r' && csvContent[index + 1] === '\n') {
        index += 1
      }
    } else {
      field += character
    }
  }

  if (insideQuotes) {
    throw new Error('A quoted CSV field was not closed.')
  }

  if (field.length > 0 || row.length > 0 || quoteClosed) {
    finishRow()
  }

  return rows
}

function isValidTransactionDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)

  return year > 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
}

function isValidMonthKey(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value)
  return Boolean(match && Number(match[1]) > 0 && Number(match[2]) >= 1 && Number(match[2]) <= 12)
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function inspectLegacyFinanceData() {
  const invalidRecords = []

  function readJson(key, fallback, isValidRoot) {
    let rawValue
    try {
      rawValue = localStorage.getItem(key)
    } catch {
      invalidRecords.push(`${key}: LocalStorage could not be read.`)
      return { present: false, value: fallback }
    }

    if (rawValue === null) return { present: false, value: fallback }

    try {
      const value = JSON.parse(rawValue)
      if (!isValidRoot(value)) {
        invalidRecords.push(`${key}: stored value has an unexpected format.`)
        return { present: true, value: fallback }
      }

      return { present: true, value }
    } catch {
      invalidRecords.push(`${key}: stored value is not valid JSON.`)
      return { present: true, value: fallback }
    }
  }

  const transactionData = readJson(
    'transactions',
    [],
    Array.isArray
  )
  const templateData = readJson(
    'recurringTransactions',
    [],
    Array.isArray
  )
  const savingsData = readJson(
    'savingsTargets',
    {},
    (value) => isRecord(value)
  )
  let monthlyBudgetRaw = null
  let monthlyBudgetPresent = false

  try {
    monthlyBudgetRaw = localStorage.getItem('monthlyBudget')
    monthlyBudgetPresent = monthlyBudgetRaw !== null
  } catch {
    invalidRecords.push('monthlyBudget: LocalStorage could not be read.')
  }

  if (
    monthlyBudgetPresent &&
    (!Number.isFinite(Number(monthlyBudgetRaw)) ||
      Number(monthlyBudgetRaw) <= 0)
  ) {
    invalidRecords.push('monthlyBudget: value must be a positive number.')
  }

  const validTemplateIds = new Set()
  const templateIdCounts = new Map()
  const validTemplateRows = new Set()
  let templateIdsNeedReplacement = 0

  templateData.value.forEach((template, index) => {
    const issues = []
    if (!isRecord(template)) {
      issues.push('not an object')
    } else {
      if (template.id == null || String(template.id).trim() === '') {
        issues.push('missing template ID')
        templateIdsNeedReplacement += 1
      } else {
        const id = String(template.id)
        templateIdCounts.set(id, (templateIdCounts.get(id) || 0) + 1)
        if (!isUuid(id)) templateIdsNeedReplacement += 1
      }
      if (typeof template.name !== 'string' || !template.name.trim()) {
        issues.push('missing description')
      }
      if (!Number.isFinite(Number(template.amount)) || Number(template.amount) <= 0) {
        issues.push('amount is not positive')
      }
      if (typeof template.category !== 'string' || !template.category.trim()) {
        issues.push('missing category')
      }
      if (!['income', 'expense'].includes(template.type)) {
        issues.push('invalid type')
      }
      if (!['weekly', 'monthly'].includes(template.frequency)) {
        issues.push('invalid frequency')
      }
      if (
        typeof template.startDate !== 'string' ||
        !isValidTransactionDate(template.startDate)
      ) {
        issues.push('invalid start date')
      }
      if (
        typeof template.nextDate !== 'string' ||
        !isValidTransactionDate(template.nextDate) ||
        (isValidTransactionDate(template.startDate) &&
          template.nextDate < template.startDate)
      ) {
        issues.push('invalid next date')
      }
      if (
        !Number.isInteger(Number(template.anchorDay)) ||
        Number(template.anchorDay) < 1 ||
        Number(template.anchorDay) > 31
      ) {
        issues.push('invalid anchor day')
      }
      if (typeof template.active !== 'boolean') {
        issues.push('missing active state')
      }
    }

    if (issues.length > 0) {
      invalidRecords.push(
        `Recurring template ${index + 1}: ${issues.join(', ')}.`
      )
    } else {
      validTemplateRows.add(index)
      validTemplateIds.add(String(template.id))
    }
  })

  templateData.value.forEach((template, index) => {
    if (
      isRecord(template) &&
      template.id != null &&
      templateIdCounts.get(String(template.id)) > 1 &&
      validTemplateRows.has(index)
    ) {
      invalidRecords.push(
        `Recurring template ${index + 1}: duplicate template ID makes transaction links ambiguous.`
      )
      validTemplateIds.delete(String(template.id))
    }
  })

  const transactionIdCounts = new Map()
  transactionData.value.forEach((transaction) => {
    if (isRecord(transaction) && transaction.id != null) {
      const id = String(transaction.id)
      transactionIdCounts.set(id, (transactionIdCounts.get(id) || 0) + 1)
    }
  })
  const transactionIdsNeedReplacement = transactionData.value.filter(
    (transaction) =>
      isRecord(transaction) &&
      (transaction.id == null ||
        !isUuid(String(transaction.id)) ||
        transactionIdCounts.get(String(transaction.id)) > 1)
  ).length

  let orphanedRecurringReferenceCount = 0
  transactionData.value.forEach((transaction, index) => {
    const issues = []
    if (!isRecord(transaction)) {
      issues.push('not an object')
    } else {
      if (typeof transaction.name !== 'string' || !transaction.name.trim()) {
        issues.push('missing description')
      }
      if (
        !Number.isFinite(Number(transaction.amount)) ||
        Number(transaction.amount) <= 0
      ) {
        issues.push('amount is not positive')
      }
      if (typeof transaction.category !== 'string' || !transaction.category.trim()) {
        issues.push('missing category')
      }
      if (!['income', 'expense'].includes(transaction.type)) {
        issues.push('invalid type')
      }
      if (
        typeof transaction.date !== 'string' ||
        !isValidTransactionDate(transaction.date)
      ) {
        issues.push('invalid date')
      }

      const templateId =
        transaction.recurringTemplateId ??
        transaction.legacyRecurringTemplateId
      const hasTemplateId =
        templateId != null && String(templateId).trim() !== ''
      const hasOccurrenceDate =
        transaction.recurringOccurrenceDate != null &&
        String(transaction.recurringOccurrenceDate).trim() !== ''

      if (hasTemplateId !== hasOccurrenceDate) {
        issues.push('incomplete recurring reference')
      } else if (
        hasOccurrenceDate &&
        !isValidTransactionDate(transaction.recurringOccurrenceDate)
      ) {
        issues.push('invalid recurring occurrence date')
      } else if (
        hasTemplateId &&
        !validTemplateIds.has(String(templateId))
      ) {
        orphanedRecurringReferenceCount += 1
      }
    }

    if (issues.length > 0) {
      invalidRecords.push(`Transaction ${index + 1}: ${issues.join(', ')}.`)
    }
  })

  Object.entries(savingsData.value).forEach(([month, amount]) => {
    if (
      !isValidMonthKey(month) ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      invalidRecords.push(
        `Savings goal ${month}: invalid month or non-positive amount.`
      )
    }
  })

  return {
    transactions: transactionData.value,
    recurringTemplates: templateData.value,
    savingsGoals: savingsData.value,
    transactionCount: transactionData.value.length,
    recurringTemplateCount: templateData.value.length,
    transactionIdsNeedReplacement,
    templateIdsNeedReplacement,
    monthlyBudgetPresent,
    monthlyBudgetRaw,
    savingsGoalCount: Object.keys(savingsData.value).length,
    invalidRecords,
    orphanedRecurringReferenceCount,
  }
}

function showMigrationPreview(
  userId,
  legacyData,
  financeData,
  cloudBudgetRecordExists
) {
  const preview = document.createElement('section')
  preview.className = 'panel migration-preview'
  preview.setAttribute('aria-labelledby', 'migration-preview-title')
  preview.innerHTML = `
    <h2 id="migration-preview-title">Review your old finance data</h2>
    <p>This preview does not migrate or change LocalStorage finance data. Normal cloud features resume after you make a choice.</p>
    <p>All transaction records are included in this review; no sample or default records are automatically excluded.</p>
    <ul class="migration-preview-counts">
      <li id="migration-transaction-count"></li>
      <li id="migration-template-count"></li>
      <li id="migration-budget-value"></li>
      <li id="migration-savings-count"></li>
      <li id="migration-invalid-count"></li>
      <li id="migration-id-remap-count"></li>
    </ul>
    <p id="migration-cloud-warning"></p>
    <p id="migration-orphan-warning"></p>
    <details>
      <summary id="migration-transactions-summary"></summary>
      <ol id="migration-transactions"></ol>
    </details>
    <details>
      <summary id="migration-templates-summary"></summary>
      <ol id="migration-templates"></ol>
    </details>
    <details>
      <summary id="migration-savings-summary"></summary>
      <ul id="migration-savings"></ul>
    </details>
    <details>
      <summary>Review invalid or incomplete records</summary>
      <ul id="migration-invalid-records"></ul>
    </details>
    <div class="migration-preview-actions">
      <button id="migration-import-choice" type="button">Import My Old Data</button>
      <button id="migration-keep-cloud-choice" type="button">Keep Cloud Data</button>
    </div>
    <p id="migration-choice-status" role="status" aria-live="polite"></p>
  `

  preview.querySelector('#migration-transaction-count').textContent =
    `Transactions found: ${legacyData.transactionCount}`
  preview.querySelector('#migration-template-count').textContent =
    `Recurring templates found: ${legacyData.recurringTemplateCount}`
  preview.querySelector('#migration-budget-value').textContent =
    `Monthly budget: ${
      legacyData.monthlyBudgetPresent
        ? legacyData.monthlyBudgetRaw
        : 'not present'
    }`
  preview.querySelector('#migration-savings-count').textContent =
    `Savings goals found: ${legacyData.savingsGoalCount}`
  preview.querySelector('#migration-invalid-count').textContent =
    `Invalid or incomplete records: ${legacyData.invalidRecords.length}`
  preview.querySelector('#migration-id-remap-count').textContent =
    `IDs needing UUID replacement: ${legacyData.transactionIdsNeedReplacement} transactions, ${legacyData.templateIdsNeedReplacement} recurring templates`

  const transactionList = preview.querySelector('#migration-transactions')
  preview.querySelector('#migration-transactions-summary').textContent =
    `Review all ${legacyData.transactionCount} transactions`
  legacyData.transactions.forEach((transaction, index) => {
    const item = document.createElement('li')
    item.textContent = isRecord(transaction)
      ? `${index + 1}. ${transaction.name || '(no description)'} — ${transaction.amount ?? '(no amount)'} | ${transaction.type || '(no type)'} | ${transaction.category || '(no category)'} | ${transaction.date || '(no date)'} | ID: ${transaction.id ?? '(missing)'} | recurring template: ${transaction.recurringTemplateId ?? transaction.legacyRecurringTemplateId ?? 'none'} | occurrence: ${transaction.recurringOccurrenceDate ?? 'none'}`
      : `${index + 1}. Invalid transaction record`
    transactionList.append(item)
  })

  const templateList = preview.querySelector('#migration-templates')
  preview.querySelector('#migration-templates-summary').textContent =
    `Review all ${legacyData.recurringTemplateCount} recurring templates`
  legacyData.recurringTemplates.forEach((template, index) => {
    const item = document.createElement('li')
    item.textContent = isRecord(template)
      ? `${index + 1}. ${template.name || '(no description)'} — ${template.amount ?? '(no amount)'} | ${template.type || '(no type)'} | ${template.category || '(no category)'} | ${template.frequency || '(no frequency)'} | start: ${template.startDate || '(no start date)'} | next: ${template.nextDate || '(no next date)'} | anchor day: ${template.anchorDay ?? '(missing)'} | active: ${template.active ?? '(missing)'} | ID: ${template.id ?? '(missing)'}`
      : `${index + 1}. Invalid recurring template record`
    templateList.append(item)
  })

  const savingsList = preview.querySelector('#migration-savings')
  preview.querySelector('#migration-savings-summary').textContent =
    `Review all ${legacyData.savingsGoalCount} savings goals`
  Object.entries(legacyData.savingsGoals).forEach(([month, amount]) => {
    const item = document.createElement('li')
    item.textContent = `${month}: ${amount}`
    savingsList.append(item)
  })

  const cloudTransactionCount = financeData.transactions.length
  const cloudTemplateCount = financeData.recurringTemplates.length
  const cloudBudgetPresent = cloudBudgetRecordExists
  const cloudSavingsGoalCount = Object.keys(financeData.savingsTargets).length
  const hasCloudData =
    cloudTransactionCount > 0 ||
    cloudTemplateCount > 0 ||
    cloudBudgetPresent ||
    cloudSavingsGoalCount > 0
  preview.querySelector('#migration-cloud-warning').textContent = hasCloudData
    ? `Cloud data already exists: ${cloudTransactionCount} transactions, ${cloudTemplateCount} recurring templates, ${
        cloudBudgetPresent ? 'a monthly budget' : 'no monthly budget'
      }, and ${cloudSavingsGoalCount} savings goals.`
    : 'No existing cloud finance records were found for this account.'
  preview.querySelector('#migration-orphan-warning').textContent =
    legacyData.orphanedRecurringReferenceCount > 0
      ? `${legacyData.orphanedRecurringReferenceCount} transaction(s) refer to recurring templates that are missing from the local template list; these need legacy-link handling.`
      : 'No orphaned recurring-template references were detected.'

  const invalidList = preview.querySelector('#migration-invalid-records')
  if (legacyData.invalidRecords.length === 0) {
    const item = document.createElement('li')
    item.textContent = 'None detected by the basic validation checks.'
    invalidList.append(item)
  } else {
    legacyData.invalidRecords.slice(0, 20).forEach((issue) => {
      const item = document.createElement('li')
      item.textContent = issue
      invalidList.append(item)
    })
    if (legacyData.invalidRecords.length > 20) {
      const item = document.createElement('li')
      item.textContent =
        `And ${legacyData.invalidRecords.length - 20} more issue(s).`
      invalidList.append(item)
    }
  }

  const dashboard = app.querySelector('#dashboard')
  dashboard.prepend(preview)

  return new Promise((resolve) => {
    const buttons = [
      preview.querySelector('#migration-import-choice'),
      preview.querySelector('#migration-keep-cloud-choice'),
    ]
    const status = preview.querySelector('#migration-choice-status')

    const recordChoice = (choice) => {
      const message =
        choice === 'import'
          ? 'Choice recorded: import the old data. No LocalStorage finance data was imported; this phase only records your choice.'
          : 'Choice recorded: keep cloud data. LocalStorage finance data was left untouched; this phase only records your choice.'

      try {
        localStorage.setItem(
          `pennywiseMigrationChoice:v1:${userId}`,
          JSON.stringify({ choice, recordedAt: new Date().toISOString() })
        )
        status.textContent = message
      } catch {
        status.textContent =
          `${message} The choice is recorded for this session only because browser storage is unavailable.`
      }

      buttons.forEach((button) => {
        button.disabled = true
      })
      migrationChoiceMade = true
      if (pendingMigrationChoiceResolver === resolve) {
        pendingMigrationChoiceResolver = null
      }
      resolve(choice)
    }

    pendingMigrationChoiceResolver = resolve
    buttons[0].addEventListener('click', () => recordChoice('import'))
    buttons[1].addEventListener('click', () => recordChoice('keep-cloud'))
  })
}

function showImportMessage(message, status) {
  importMessage.textContent = message
  importMessage.className = `import-message ${status}`
}

async function importTransactions() {
  const file = importCsvInput.files[0]
  if (!file) return

  try {
    const csvContent = (await file.text()).replace(/^\uFEFF/, '')
    if (!csvContent.trim()) {
      showImportMessage('The selected CSV file is empty.', 'error')
      return
    }

    const rows = parseCSV(csvContent)
    const expectedHeaders = [
      'Description',
      'Category',
      'Amount',
      'Type',
      'Date'
    ]
    const headers = rows.shift()?.map((header) => header.trim()) || []

    if (
      headers.length !== expectedHeaders.length ||
      expectedHeaders.some((header, index) => headers[index] !== header)
    ) {
      showImportMessage(
        'Import failed: CSV headers must be Description, Category, Amount, Type, Date.',
        'error'
      )
      return
    }

    const transactionRows = rows.filter((row) =>
      row.some((value) => value.trim() !== '')
    )

    if (transactionRows.length === 0) {
      showImportMessage('The CSV contains no transaction rows.', 'error')
      return
    }

    const importedTransactions = []
    let skippedCount = 0

    transactionRows.forEach((row) => {
      if (row.length !== expectedHeaders.length) {
        skippedCount += 1
        return
      }

      const [rawDescription, rawCategory, rawAmount, rawType, rawDate] = row
      const name = rawDescription.trim()
      const category = rawCategory.trim()
      const amount = Number(rawAmount.trim())
      const type = rawType.trim()
      const date = rawDate.trim()

      if (
        !name ||
        !Number.isFinite(amount) ||
        amount <= 0 ||
        !['income', 'expense'].includes(type) ||
        !category ||
        !isValidTransactionDate(date)
      ) {
        skippedCount += 1
        return
      }

      importedTransactions.push({
        id: crypto.randomUUID(),
        name,
        category,
        amount,
        type,
        date
      })
    })

    const savedTransactions = []
    let failedCount = 0
    let firstFailure = ''
    importButton.disabled = true

    try {
      for (const transaction of importedTransactions) {
        try {
          savedTransactions.push(
            await insertTransaction(user.id, transaction)
          )
        } catch (error) {
          failedCount += 1
          if (!firstFailure) {
            firstFailure =
              error instanceof Error ? error.message : String(error)
          }
        }
      }
    } finally {
      if (importButton.isConnected) importButton.disabled = false
    }

    if (savedTransactions.length > 0) {
      transactions = prependTransactions(transactions, savedTransactions)
      renderTransactions()
    }

    const importedCount = savedTransactions.length
    const status =
      skippedCount === 0 && failedCount === 0 ? 'success' : 'warning'
    const failureDetail = firstFailure ? ` First error: ${firstFailure}` : ''
    showImportMessage(
      `Imported ${importedCount} transaction${importedCount === 1 ? '' : 's'}; ` +
        `skipped ${skippedCount} invalid row${skippedCount === 1 ? '' : 's'}; ` +
        `failed to save ${failedCount} row${failedCount === 1 ? '' : 's'}.` +
        failureDetail,
      status
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read the selected file.'
    showImportMessage(`Import failed: ${message}`, 'error')
  } finally {
    importCsvInput.value = ''
  }
}


function updateMonthlyExpenseChart() {
  const labels = []
  const monthlyTotals = []
  const today = new Date()

  for (let i = 5; i >= 0; i--) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const monthKey = `${year}-${month}`

    labels.push(
      date.toLocaleString('en-IN', { month: 'short', year: '2-digit' })
    )

    const total = transactions
      .filter((item) =>
        item.type === 'expense' && item.date.startsWith(monthKey)
      )
      .reduce((sum, item) => sum + Number(item.amount), 0)

    monthlyTotals.push(total)
  }

  if (monthlyExpenseChart) {
    monthlyExpenseChart.data.labels = labels
    monthlyExpenseChart.data.datasets[0].data = monthlyTotals
    monthlyExpenseChart.update()
    return
  }

  const ctx = document.querySelector('#monthly-expense-chart')

  monthlyExpenseChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Monthly Expenses',
        data: monthlyTotals,
        borderRadius: 6,
        backgroundColor: '#16a34a',
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => '₹' + value
          }
        }
      }
    }
  })
}

function updateCategoryExpenseChart() {
  const categoryTotals = {}

  transactions
    .filter((item) =>
      item.type === 'expense' && item.date.startsWith(monthFilter.value)
    )
    .forEach((item) => {
      if (!categoryTotals[item.category]) {
        categoryTotals[item.category] = 0
      }
      categoryTotals[item.category] += Number(item.amount)
    })

  const labels = Object.keys(categoryTotals)
  const amounts = Object.values(categoryTotals)
  if (labels.length === 0) {
    labels.push('No expenses this month')
    amounts.push(0)
  }

  const colors = [
    '#16a34a', '#3b82f6', '#f59e0b',
    '#ec4899', '#8b5cf6', '#64748b', '#0ea5e9'
  ]
  const backgroundColors = labels[0] === 'No expenses this month'
    ? ['#94a3b8']
    : labels.map((_, index) => colors[index % colors.length])

  if (categoryExpenseChart) {
    categoryExpenseChart.data.labels = labels
    categoryExpenseChart.data.datasets[0].data = amounts
    categoryExpenseChart.data.datasets[0].backgroundColor = backgroundColors
    categoryExpenseChart.update()
    return
  }

  const ctx = document.querySelector('#category-expense-chart')

  categoryExpenseChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: amounts,
        backgroundColor: backgroundColors,
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  })
}

function updateIncomeExpenseChart() {
  const labels = []
  const incomeTotals = []
  const expenseTotals = []

  const today = new Date()

  // Calculate income and expenses for the last 6 months
  for (let i = 5; i >= 0; i--) {
    const date = new Date(
      today.getFullYear(),
      today.getMonth() - i,
      1
    )

    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const monthKey = `${year}-${month}`

    labels.push(
      date.toLocaleString('en-IN', {
        month: 'short',
        year: '2-digit'
      })
    )

    const monthlyTransactions = transactions.filter(
      (item) => item.date.startsWith(monthKey)
    )

    const income = monthlyTransactions
      .filter((item) => item.type === 'income')
      .reduce((sum, item) => sum + Number(item.amount), 0)

    const expenses = monthlyTransactions
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + Number(item.amount), 0)

    incomeTotals.push(income)
    expenseTotals.push(expenses)
  }

  if (incomeExpenseChart) {
    incomeExpenseChart.data.labels = labels
    incomeExpenseChart.data.datasets[0].data = incomeTotals
    incomeExpenseChart.data.datasets[1].data = expenseTotals
    incomeExpenseChart.update()
    return
  }

  const ctx = document.querySelector('#income-expense-chart')

  incomeExpenseChart = new Chart(ctx, {
    type: 'bar',

    data: {
      labels,
      datasets: [
        {
          label: 'Income',
          data: incomeTotals,
          backgroundColor: '#16a34a',
          borderRadius: 5
        },
        {
          label: 'Expenses',
          data: expenseTotals,
          backgroundColor: '#ef4444',
          borderRadius: 5
        }
      ]
    },

    options: {
      responsive: true,
      maintainAspectRatio: false,

      plugins: {
        legend: {
          position: 'bottom'
        }
      },

      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => '₹' + value
          }
        }
      }
    }
  })
}



function renderTransactions() {
  const visibleTransactions = getVisibleTransactions()
  const monthlyTransactions = transactions.filter((item) =>
    item.date.startsWith(monthFilter.value)
  )

  updateMonthlyExpenseChart()
  updateCategoryExpenseChart()
  updateIncomeExpenseChart()
  updateSavingsGoalDisplay()
  updateMonthlyFinancialInsights()

  const income = monthlyTransactions
    .filter((item) => item.type === 'income')
    .reduce((total, item) => total + Number(item.amount), 0)

  const expenses = monthlyTransactions
    .filter((item) => item.type === 'expense')
    .reduce((total, item) => total + Number(item.amount), 0)

  document.querySelector('#balance').textContent =
    formatMoney(income - expenses)

  document.querySelector('#income').textContent =
    formatMoney(income)

  document.querySelector('#expenses').textContent =
    formatMoney(expenses)

  list.innerHTML = ''
  if (visibleTransactions.length === 0) {
    const emptyState = document.createElement('p')
    emptyState.className = 'empty-state'
    emptyState.textContent = monthlyTransactions.length === 0
      ? 'No transactions for this month yet. Add one to get started.'
      : 'No transactions match your search and filters.'
    list.append(emptyState)
    updateBudgetDisplay()
    return
  }

  visibleTransactions.forEach((item) => {
    const row = document.createElement('div')
    row.className = 'transaction-row'

    const details = document.createElement('div')
    const name = document.createElement('strong')
    const category = document.createElement('p')

    name.textContent = item.name
    category.textContent = `${item.category} · ${item.date}`

    details.append(name, category)

    const amount = document.createElement('strong')
    amount.className = item.type
    amount.textContent =
      `${item.type === 'income' ? '+' : '−'}${formatMoney(Number(item.amount))}`

    // EDIT BUTTON
    const editButton = document.createElement('button')
    editButton.textContent = 'Edit'
    editButton.className = 'edit-btn'

    editButton.addEventListener('click', () => {
      editingTransactionId = item.id

      document.querySelector('#name').value = item.name
      document.querySelector('#amount').value = item.amount
      document.querySelector('#type').value = item.type
      document.querySelector('#category').value = item.category
      document.querySelector('#date').value = item.date

      document.querySelector('#transaction-form button').textContent =
        'Update transaction'

      document.querySelector('#transaction-form h2').textContent =
        'Edit transaction'

      document.querySelector('#transaction-form').scrollIntoView({
        behavior: 'smooth'
      })
    })

    // DELETE BUTTON
    const deleteButton = document.createElement('button')
    deleteButton.textContent = 'Delete'
    deleteButton.className = 'delete-btn'

    deleteButton.addEventListener('click', () => {
      deleteTransaction(item.id)
    })

    row.append(details, amount, editButton, deleteButton)
    list.append(row)
  })
  updateBudgetDisplay()
}




form.addEventListener('submit', async (event) => {
  event.preventDefault()

  const name = document.querySelector('#name').value.trim()
  const amount = Number(document.querySelector('#amount').value)
  const type = document.querySelector('#type').value
  const category = document.querySelector('#category').value
  const date = document.querySelector('#date').value

  if (
    !name ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !['income', 'expense'].includes(type) ||
    !category ||
    !isValidTransactionDate(date)
  ) {
    showTransactionMessage(
      'Enter a description, positive amount, category, type, and valid date.',
      'error'
    )
    return
  }

  const transaction = {
    name,
    amount,
    type,
    category,
    date,
  }
  const wasEditing = Boolean(editingTransactionId)

  const submitButton = form.querySelector('button[type="submit"]')
  submitButton.disabled = true
  try {
    if (editingTransactionId) {
      const updated = await updateTransaction(
        user.id,
        editingTransactionId,
        transaction
      )
      transactions = transactions.map((item) =>
        item.id === editingTransactionId ? updated : item
      )
    } else {
      const inserted = await insertTransaction(user.id, {
        ...transaction,
        id: crypto.randomUUID(),
      })
      transactions = prependTransactions(transactions, [inserted])
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showTransactionMessage(`Transaction could not be saved. ${detail}`, 'error')
    return
  } finally {
    if (submitButton.isConnected) submitButton.disabled = false
  }

  editingTransactionId = null
  form.reset()

  document.querySelector('#date').value = formatLocalDate(new Date())

  document.querySelector('#transaction-form button').textContent =
    'Add transaction'
  document.querySelector('#transaction-form h2').textContent =
    'Add a transaction'

  showTransactionMessage(
    wasEditing ? 'Transaction updated.' : 'Transaction added.'
  )
  renderTransactions()
})
async function deleteTransaction(id) {
  try {
    await deleteCloudTransaction(user.id, id)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    showTransactionMessage(`Transaction could not be deleted. ${detail}`, 'error')
    return
  }

  transactions = transactions.filter((item) => item.id !== id)
  showTransactionMessage('Transaction deleted.')
  renderTransactions()
}



const migrationChoiceKey = `pennywiseMigrationChoice:v1:${user.id}`
let savedMigrationChoice = null
try {
  const savedChoiceJson = localStorage.getItem(migrationChoiceKey)
  if (savedChoiceJson !== null) {
    const savedChoice = JSON.parse(savedChoiceJson)
    if (
      savedChoice &&
      typeof savedChoice === 'object' &&
      !Array.isArray(savedChoice) &&
      savedChoice.choice === 'keep-cloud'
    ) {
      savedMigrationChoice = savedChoice.choice
    }
  }
} catch (error) {
  console.warn('Could not read the saved migration choice; showing the preview.', error)
}

let migrationChoice
if (savedMigrationChoice === 'keep-cloud') {
  migrationChoiceMade = true
  migrationChoice = savedMigrationChoice
} else {
  migrationChoice = await showMigrationPreview(
    user.id,
    legacyFinanceData,
    financeData,
    Boolean(cloudBudgetRow)
  )
}
if (migrationChoice === null || loadGeneration !== dashboardLoadGeneration) {
  return () => {
    [monthlyExpenseChart, categoryExpenseChart, incomeExpenseChart]
      .filter(Boolean)
      .forEach((chart) => chart.destroy())
  }
}

await processDueRecurringTransactions()
if (loadGeneration !== dashboardLoadGeneration) {
  return () => {
    [monthlyExpenseChart, categoryExpenseChart, incomeExpenseChart]
      .filter(Boolean)
      .forEach((chart) => chart.destroy())
  }
}

renderRecurringTransactions()
renderTransactions()

return () => {
  [monthlyExpenseChart, categoryExpenseChart, incomeExpenseChart]
    .filter(Boolean)
    .forEach((chart) => chart.destroy())
}
}
