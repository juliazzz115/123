// Данные приложения
let clients = ['Иван Иванов', 'Петр Петров', 'Мария Сидорова', 'Анна Смирнова'];
let tableData = [];
let currentMode = 'mode-a';

// Конфигурация колонок для разных режимов
const modeConfig = {
    'mode-a': {
        columns: ['Подал сам', 'Пометить', 'Проверить']
    },
    'mode-b': {
        columns: ['Оплатил', 'Подано', 'Помечено', 'Проверено']
    }
};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

function initializeApp() {
    loadClientsToSelect();
    renderTable();
    attachEventListeners();
}

// Загрузка клиентов в выпадающий список
function loadClientsToSelect() {
    const select = document.getElementById('clientSelect');
    select.innerHTML = '<option value="">-- Выберите клиента --</option>';

    clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client;
        option.textContent = client;
        select.appendChild(option);
    });
}

// Привязка обработчиков событий
function attachEventListeners() {
    // Переключение режима
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentMode = e.target.value;
            renderTable();
        });
    });

    // Добавление клиента в таблицу
    document.getElementById('addClientBtn').addEventListener('click', addClientToTable);

    // Создание нового клиента
    document.getElementById('addNewClientBtn').addEventListener('click', createNewClient);

    // Enter для создания нового клиента
    document.getElementById('newClientName').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            createNewClient();
        }
    });
}

// Добавление клиента в таблицу
function addClientToTable() {
    const select = document.getElementById('clientSelect');
    const selectedClient = select.value;

    if (!selectedClient) {
        alert('Пожалуйста, выберите клиента из списка');
        return;
    }

    // Проверка, нет ли уже такого клиента в таблице
    const exists = tableData.some(item => item.name === selectedClient);
    if (exists) {
        alert('Этот клиент уже добавлен в таблицу');
        return;
    }

    // Создание объекта клиента с пустыми статусами
    const clientData = {
        id: Date.now(),
        name: selectedClient,
        statuses: {}
    };

    // Инициализация статусов для текущего режима
    modeConfig[currentMode].columns.forEach(col => {
        clientData.statuses[col] = false;
    });

    tableData.push(clientData);
    renderTable();
    select.value = '';
}

// Создание нового клиента
function createNewClient() {
    const input = document.getElementById('newClientName');
    const newClientName = input.value.trim();

    if (!newClientName) {
        alert('Пожалуйста, введите имя клиента');
        return;
    }

    // Проверка на дубликаты
    if (clients.includes(newClientName)) {
        alert('Клиент с таким именем уже существует');
        return;
    }

    clients.push(newClientName);
    loadClientsToSelect();
    input.value = '';

    // Уведомление
    showNotification(`Клиент "${newClientName}" успешно добавлен`);
}

// Отрисовка таблицы
function renderTable() {
    const thead = document.getElementById('tableHeader');
    const tbody = document.getElementById('tableBody');

    // Отрисовка заголовка
    const columns = modeConfig[currentMode].columns;
    thead.innerHTML = `
        <th>Имя клиента</th>
        ${columns.map(col => `<th>${col}</th>`).join('')}
        <th>Действия</th>
    `;

    // Отрисовка тела таблицы
    if (tableData.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${columns.length + 2}" class="empty-message">
                    Таблица пуста. Выберите клиента из списка и добавьте его.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = tableData.map(client => {
        // Инициализация недостающих статусов для текущего режима
        columns.forEach(col => {
            if (!(col in client.statuses)) {
                client.statuses[col] = false;
            }
        });

        return `
            <tr>
                <td><strong>${client.name}</strong></td>
                ${columns.map(col => `
                    <td>
                        <input
                            type="checkbox"
                            ${client.statuses[col] ? 'checked' : ''}
                            onchange="toggleStatus(${client.id}, '${col}')"
                        >
                    </td>
                `).join('')}
                <td>
                    <button class="btn btn-danger" onclick="removeClient(${client.id})">
                        Удалить
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Переключение статуса
function toggleStatus(clientId, columnName) {
    const client = tableData.find(c => c.id === clientId);
    if (client) {
        client.statuses[columnName] = !client.statuses[columnName];
        saveToLocalStorage();
    }
}

// Удаление клиента из таблицы
function removeClient(clientId) {
    const client = tableData.find(c => c.id === clientId);
    if (client && confirm(`Удалить клиента "${client.name}" из таблицы?`)) {
        tableData = tableData.filter(c => c.id !== clientId);
        renderTable();
        saveToLocalStorage();
    }
}

// Уведомление
function showNotification(message) {
    // Создание элемента уведомления
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #48bb78;
        color: white;
        padding: 15px 25px;
        border-radius: 5px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        z-index: 1000;
        animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(notification);

    // Удаление через 3 секунды
    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Сохранение данных в localStorage
function saveToLocalStorage() {
    localStorage.setItem('clientTrackerData', JSON.stringify(tableData));
    localStorage.setItem('clientTrackerClients', JSON.stringify(clients));
}

// Загрузка данных из localStorage
function loadFromLocalStorage() {
    const savedData = localStorage.getItem('clientTrackerData');
    const savedClients = localStorage.getItem('clientTrackerClients');

    if (savedData) {
        tableData = JSON.parse(savedData);
    }

    if (savedClients) {
        clients = JSON.parse(savedClients);
    }
}

// Загрузка данных при инициализации
loadFromLocalStorage();

// CSS для анимаций уведомлений
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
