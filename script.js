// Данные приложения
let clients = ['Иван Иванов', 'Петр Петров', 'Мария Сидорова', 'Анна Смирнова'];
let tableData = [];
let currentMode = 'mode-a';
let csvData = [];

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

    // Обработчики для формы документа
    document.getElementById('csvFile').addEventListener('change', handleCSVUpload);
    document.getElementById('csvDataSelect').addEventListener('change', handleSelectChange);
    document.getElementById('downloadDocBtn').addEventListener('click', downloadDocument);
    document.getElementById('clearFormBtn').addEventListener('click', clearDocumentForm);
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

// ============================================
// ФУНКЦИИ ДЛЯ РАБОТЫ С ФОРМОЙ ДОКУМЕНТА
// ============================================

// Обработка загрузки CSV файла
function handleCSVUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const text = e.target.result;
        parseCSV(text);
    };
    reader.readAsText(file, 'UTF-8');
}

// Парсинг CSV данных
function parseCSV(text) {
    const lines = text.split('\n').filter(line => line.trim());

    if (lines.length === 0) {
        alert('CSV файл пустой');
        return;
    }

    // Первая строка - заголовки
    const headers = lines[0].split(',').map(h => h.trim());

    // Остальные строки - данные
    csvData = [];
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row = {};

        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });

        csvData.push(row);
    }

    // Заполнение выпадающего списка
    populateCSVSelect(headers);
    showNotification(`CSV файл успешно загружен! Найдено ${csvData.length} записей`);
}

// Заполнение выпадающего списка данными из CSV
function populateCSVSelect(headers) {
    const select = document.getElementById('csvDataSelect');
    select.innerHTML = '<option value="">-- Выберите запись --</option>';

    csvData.forEach((row, index) => {
        const option = document.createElement('option');
        // Используем первый столбец как отображаемое значение
        const firstValue = row[headers[0]] || `Запись ${index + 1}`;
        option.value = index;
        option.textContent = firstValue;
        option.dataset.rowData = JSON.stringify(row);
        select.appendChild(option);
    });

    select.disabled = false;
}

// Обработка выбора значения из списка
function handleSelectChange(event) {
    const select = event.target;
    const selectedOption = select.options[select.selectedIndex];

    if (!selectedOption.dataset.rowData) {
        document.getElementById('selectedValue').value = '';
        return;
    }

    const rowData = JSON.parse(selectedOption.dataset.rowData);
    // Отображаем все данные выбранной строки
    const displayValue = Object.entries(rowData)
        .map(([key, value]) => `${key}: ${value}`)
        .join(', ');

    document.getElementById('selectedValue').value = displayValue;
}

// Скачивание документа
function downloadDocument() {
    // Сбор данных из формы
    const staticField1 = document.getElementById('staticField1').value;
    const staticField2 = document.getElementById('staticField2').value;
    const staticField3 = document.getElementById('staticField3').value;
    const selectedValue = document.getElementById('selectedValue').value;

    // Проверка заполненности
    if (!staticField1 && !staticField2 && !staticField3 && !selectedValue) {
        alert('Пожалуйста, заполните хотя бы одно поле');
        return;
    }

    // Формирование содержимого документа
    const documentContent = `
ФОРМА ДОКУМЕНТА
================

Название документа: ${staticField1 || 'Не указано'}
Дата создания: ${staticField2 || 'Не указана'}
Описание: ${staticField3 || 'Не указано'}

Данные из CSV:
${selectedValue || 'Не выбрано'}

Создано: ${new Date().toLocaleString('ru-RU')}
    `.trim();

    // Создание и скачивание файла
    const blob = new Blob([documentContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `document_${Date.now()}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showNotification('Документ успешно скачан!');
}

// Очистка формы документа
function clearDocumentForm() {
    document.getElementById('staticField1').value = '';
    document.getElementById('staticField2').value = '';
    document.getElementById('staticField3').value = '';
    document.getElementById('csvFile').value = '';
    document.getElementById('csvDataSelect').innerHTML = '<option value="">-- Сначала загрузите CSV файл --</option>';
    document.getElementById('csvDataSelect').disabled = true;
    document.getElementById('selectedValue').value = '';
    csvData = [];

    showNotification('Форма очищена');
}
