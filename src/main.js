
import './style.css'
import Chart from 'chart.js/auto'

const defaultTransactions = [
  { name: 'Hostel mess', category: 'Food', amount: 2500, type: 'expense', date: '2026-11-01' },
  { name: 'Pocket money', category: 'Income', amount: 5000, type: 'income', date: '2026-11-01' },
  { name: 'Stationery', category: 'Education', amount: 150, type: 'expense', date: '2026-11-01' },
]

let transactions = JSON.parse(localStorage.getItem('transactions')) || defaultTransactions

transactions = transactions.map((item) => ({
  ...item,
  id: item.id || crypto.randomUUID(),
}))
saveTransactions()
const app = document.querySelector('#app')

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
      <section class="panel analytics" id="analytics">
  <h2>Monthly Expenses</h2>
  <p class="chart-subtitle">Your spending over the last 6 months</p>

  <div class="chart-container">
    <canvas id="monthly-expense-chart"></canvas>
  </div>

</section>
 <section class="panel analytics">
      <h2>Category-wise Spending</h2>
      <p class="chart-subtitle">See where your money goes</p>

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

    <section class="content">
      <form id="transaction-form" class="panel">
        <h2>Add a transaction</h2>

        <label for="name">Description</label>
        <input id="name" type="text" placeholder="e.g. Groceries" required>

        <label for="amount">Amount (₹)</label>
        <input id="amount" type="number" min="1" step="0.01" placeholder="e.g. 250" required>

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
  </div>

  <div id="transaction-list"></div>
</section>
    </section>
  </main>
`

const form = document.querySelector('#transaction-form')
const list = document.querySelector('#transaction-list')
let monthlyExpenseChart = null
let categoryExpenseChart = null
let incomeExpenseChart = null
const monthFilter = document.querySelector('#month-filter')
const searchInput = document.querySelector('#search-input')
const categoryFilter = document.querySelector('#category-filter')
const typeFilter = document.querySelector('#type-filter')
let editingTransactionId = null

const today = new Date()
const currentMonth =
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

monthFilter.value = currentMonth
monthFilter.addEventListener('change', renderTransactions)
searchInput.addEventListener('input', renderTransactions)
categoryFilter.addEventListener('change', renderTransactions)
typeFilter.addEventListener('change', renderTransactions)

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

document.querySelector('#date').value =
  new Date().toISOString().slice(0, 10)

function formatMoney(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount)
}
function saveTransactions() {
  localStorage.setItem('transactions', JSON.stringify(transactions))
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
      .reduce((sum, item) => sum + item.amount, 0)

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
    .filter((item) => item.type === 'expense')
    .forEach((item) => {
      if (!categoryTotals[item.category]) {
        categoryTotals[item.category] = 0
      }
      categoryTotals[item.category] += item.amount
    })

  const labels = Object.keys(categoryTotals)
  const amounts = Object.values(categoryTotals)
  if (labels.length === 0) {
  labels.push('No expenses')
  amounts.push(1)
}

  const colors = [
    '#16a34a', '#3b82f6', '#f59e0b',
    '#ec4899', '#8b5cf6', '#64748b'
  ]

  if (categoryExpenseChart) {
    categoryExpenseChart.data.labels = labels
    categoryExpenseChart.data.datasets[0].data = amounts
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
        backgroundColor: colors,
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
      .reduce((sum, item) => sum + item.amount, 0)

    const expenses = monthlyTransactions
      .filter((item) => item.type === 'expense')
      .reduce((sum, item) => sum + item.amount, 0)

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
    updateMonthlyExpenseChart()
    updateCategoryExpenseChart()
    updateIncomeExpenseChart()

  const income = visibleTransactions
    .filter((item) => item.type === 'income')
    .reduce((total, item) => total + item.amount, 0)

  const expenses = visibleTransactions
    .filter((item) => item.type === 'expense')
    .reduce((total, item) => total + item.amount, 0)

  document.querySelector('#balance').textContent =
    formatMoney(income - expenses)

  document.querySelector('#income').textContent =
    formatMoney(income)

  document.querySelector('#expenses').textContent =
    formatMoney(expenses)

  list.innerHTML = ''
  if (visibleTransactions.length === 0) {
  list.innerHTML = `
    <p class="empty-state">
      No transactions found. Try changing your search or filters.
    </p>
  `
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
      `${item.type === 'income' ? '+' : '−'}${formatMoney(item.amount)}`

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
}




form.addEventListener('submit', (event) => {
  event.preventDefault()

  const name = document.querySelector('#name').value.trim()
  const amount = Number(document.querySelector('#amount').value)

  if (!name || !Number.isFinite(amount) || amount <= 0) {
    return
  }

  const transaction = {
    name,
    amount,
    type: document.querySelector('#type').value,
    category: document.querySelector('#category').value,
    date: document.querySelector('#date').value,
  }

 if (editingTransactionId) {
  transactions = transactions.map((item) =>
    item.id === editingTransactionId
      ? { ...item, ...transaction }
      : item
  )
} else {
  transactions.unshift({
    ...transaction,
    id: crypto.randomUUID(),
  })
}

saveTransactions()

editingTransactionId = null
  form.reset()

  document.querySelector('#date').value =
    new Date().toISOString().slice(0, 10)

  document.querySelector('#transaction-form button').textContent =
    'Add transaction'
    document.querySelector('#transaction-form h2').textContent =
  'Add a transaction'

  renderTransactions()
})
function deleteTransaction(id) {
  transactions = transactions.filter((item) => item.id !== id)

  saveTransactions()
  renderTransactions()
  
}



renderTransactions()
