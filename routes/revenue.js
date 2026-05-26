const express = require('express');
const router = express.Router();
const Revenue = require('../models/Revenue');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const TERMINAL_COLORS = {
  'Terminal 1':      { header: 'FF1F4E79', row1: 'FFD6E4F0', row2: 'FFEBF4FA' },
  'Terminal 2':      { header: 'FF375623', row1: 'FFD6EAC8', row2: 'FFECF4E3' },
  'Abakpa Terminal': { header: 'FF7B2D00', row1: 'FFF4D3C0', row2: 'FFFAEAE0' },
  'Gariki Terminal': { header: 'FF4A235A', row1: 'FFE8D5F0', row2: 'FFF5EEF8' },
};

// POST - Save a new entry
router.post('/', async (req, res) => {
  try {
    const { terminal, date, day, totalAmountPerDay, expensesDescription, totalExpensesPerDay } = req.body;
    const remainingBalancePerDay = totalAmountPerDay - totalExpensesPerDay;
    const lastRecord = await Revenue.findOne({ terminal }).sort({ date: -1 });
    const previousTotal = lastRecord ? lastRecord.cumulativeTotal : 0;
    const cumulativeTotal = previousTotal + remainingBalancePerDay;

    const entry = new Revenue({
      terminal, date, day, totalAmountPerDay,
      expensesDescription, totalExpensesPerDay,
      remainingBalancePerDay, cumulativeTotal
    });

    await entry.save();
    await generateExcelForTerminal(terminal);
    res.status(201).json({ message: `Entry saved! Excel updated for ${terminal}`, entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Fetch all records (filter by terminal if provided)
router.get('/', async (req, res) => {
  try {
    const filter = req.query.terminal ? { terminal: req.query.terminal } : {};
    const records = await Revenue.find(filter).sort({ date: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Summary totals per terminal
router.get('/summary', async (req, res) => {
  try {
    const summary = await Revenue.aggregate([
      {
        $group: {
          _id: '$terminal',
          totalRevenue: { $sum: '$totalAmountPerDay' },
          totalExpenses: { $sum: '$totalExpensesPerDay' },
          totalBalance: { $sum: '$remainingBalancePerDay' },
          entryCount: { $sum: 1 }
        }
      }
    ]);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE - Remove a record and recalculate
router.delete('/:id', async (req, res) => {
  try {
    const record = await Revenue.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    const terminal = record.terminal;
    await Revenue.findByIdAndDelete(req.params.id);
    await recalculateCumulative(terminal);
    await generateExcelForTerminal(terminal);
    res.json({ message: 'Record deleted and Excel updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET - Download Excel for a terminal
router.get('/download/:terminal', async (req, res) => {
  try {
    const terminal = decodeURIComponent(req.params.terminal);
    const safeName = terminal.replace(/\s+/g, '_');
    const filePath = path.join(__dirname, '../exports', `${safeName}.xlsx`);
    if (!fs.existsSync(filePath)) await generateExcelForTerminal(terminal);
    res.download(filePath, `${safeName}_Revenue.xlsx`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function recalculateCumulative(terminal) {
  const records = await Revenue.find({ terminal }).sort({ date: 1 });
  let running = 0;
  for (const record of records) {
    running += record.remainingBalancePerDay;
    await Revenue.findByIdAndUpdate(record._id, { cumulativeTotal: running });
  }
}

async function generateExcelForTerminal(terminal) {
  const records = await Revenue.find({ terminal }).sort({ date: 1 });
  const colors = TERMINAL_COLORS[terminal] || TERMINAL_COLORS['Terminal 1'];
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Enugu East Bus Terminal Revenue System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(terminal, {
    pageSetup: { paperSize: 9, orientation: 'landscape' }
  });

  // Title row
  sheet.mergeCells('A1:G1');
  const titleCell = sheet.getCell('A1');
  titleCell.value = `ENUGU EAST BUS TERMINAL - ${terminal.toUpperCase()} REVENUE RECORD`;
  titleCell.font = { name: 'Arial', bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 35;

  // Subtitle
  sheet.mergeCells('A2:G2');
  const subCell = sheet.getCell('A2');
  subCell.value = `Generated: ${new Date().toLocaleDateString('en-NG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;
  subCell.font = { name: 'Arial', italic: true, size: 10 };
  subCell.alignment = { horizontal: 'center' };
  sheet.getRow(2).height = 20;

  // Column widths
  sheet.columns = [
    { key: 'sn', width: 6 },
    { key: 'date', width: 16 },
    { key: 'day', width: 14 },
    { key: 'totalAmountPerDay', width: 22 },
    { key: 'expensesDescription', width: 35 },
    { key: 'totalExpensesPerDay', width: 22 },
    { key: 'remainingBalancePerDay', width: 22 },
  ];

  // Header row
  const headers = ['S/N', 'Date', 'Day', 'Total Amount/Day (₦)', 'Expenses Description', 'Total Expenses/Day (₦)', 'Remaining Balance/Day (₦)'];
  const headerRow = sheet.getRow(3);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'thin', color: { argb: 'FFFFFFFF' } }, left: { style: 'thin', color: { argb: 'FFFFFFFF' } }, bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } }, right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
  headerRow.height = 40;

  // Data rows
  records.forEach((record, index) => {
    const row = sheet.getRow(index + 4);
    const bgColor = index % 2 === 0 ? colors.row1 : colors.row2;
    const values = [
      index + 1,
      new Date(record.date).toLocaleDateString('en-NG'),
      record.day,
      record.totalAmountPerDay,
      record.expensesDescription,
      record.totalExpensesPerDay,
      record.remainingBalancePerDay,
    ];
    values.forEach((val, i) => {
      const cell = row.getCell(i + 1);
      cell.value = val;
      cell.font = { name: 'Arial', size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 4 ? 'left' : 'center' };
      cell.border = { top: { style: 'hair' }, left: { style: 'hair' }, bottom: { style: 'hair' }, right: { style: 'hair' } };
      if ([3, 5, 6].includes(i)) cell.numFmt = '₦#,##0.00';
    });
    row.height = 22;
  });

  // Totals row
  if (records.length > 0) {
    const totalRow = sheet.getRow(records.length + 4);
    totalRow.getCell(1).value = 'TOTAL';
    const startRow = 4;
    const endRow = records.length + 3;
    totalRow.getCell(4).value = { formula: `SUM(D${startRow}:D${endRow})` };
    totalRow.getCell(4).numFmt = '₦#,##0.00';
    totalRow.getCell(6).value = { formula: `SUM(F${startRow}:F${endRow})` };
    totalRow.getCell(6).numFmt = '₦#,##0.00';
    totalRow.getCell(7).value = { formula: `SUM(G${startRow}:G${endRow})` };
    totalRow.getCell(7).numFmt = '₦#,##0.00';
    for (let i = 1; i <= 7; i++) {
      const cell = totalRow.getCell(i);
      cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      cell.border = { top: { style: 'medium' }, left: { style: 'thin' }, bottom: { style: 'medium' }, right: { style: 'thin' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    }
    totalRow.height = 28;
  }

  const exportsDir = path.join(__dirname, '../exports');
  if (!fs.existsSync(exportsDir)) fs.mkdirSync(exportsDir, { recursive: true });
  const safeName = terminal.replace(/\s+/g, '_');
  const filePath = path.join(exportsDir, `${safeName}.xlsx`);
  await workbook.xlsx.writeFile(filePath);
  console.log(`✅ Excel updated: ${filePath}`);
}

module.exports = router;