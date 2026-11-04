
import './style.css'

const transactions = [
  { name: 'Hostel mess', category: 'Food', amount: 2500, type: 'expense', date: '2026-11-01' },
  { name: 'Pocket money', category: 'Income', amount: 5000, type: 'income', date: '2026-11-01' },
  { name: 'Stationery', category: 'Education', amount: 150, type: 'expense', date: '2026-11-01' },
]

const app = document.querySelector('#app')

app.innerHTML = `
  <header class="topbar">
    <h1>Pennywise</h1>
    <span>Personal Finance Tracker</span>
  </header>

  <main class="container">
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
        </select>

        <label for="date">Date</label>
        <input id="date" type="date" required>

        <button type="submit">Add transaction</button>
      </form>

      <section class="panel transactions">
        <h2>Recent transactions</h2>
        <div id="transaction-list"></div>
      </section>
    </section>
  </main>
`

const form = document.querySelector('#transaction-form')
const list = document.querySelector('#transaction-list')
const monthFilter = document.querySelector('#month-filter')

const today = new Date()
const currentMonth =
  `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

monthFilter.value = currentMonth
monthFilter.addEventListener('change', renderTransactions)

function getVisibleTransactions() {
  return transactions.filter((item) => item.date.startsWith(monthFilter.value))
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

function renderTransactions() {
    const visibleTransactions = getVisibleTransactions()
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

    row.append(details, amount)
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

  transactions.unshift({
    name,
    amount,
    type: document.querySelector('#type').value,
    category: document.querySelector('#category').value,
    date: document.querySelector('#date').value,
  })

  form.reset()
  document.querySelector('#date').value =
    new Date().toISOString().slice(0, 10)

  renderTransactions()
})

renderTransactions()
