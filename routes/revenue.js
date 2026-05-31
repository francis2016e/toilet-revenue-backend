const express = require('express');
const router = express.Router();
const Revenue = require('../models/Revenue');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

const TERMINAL_COLORS = {
  'Terminal 1': {
    header: 'FF1F4E79',
    row1: 'FFD6E4F0',
    row2: 'FFEBF4FA'
  },
  'Terminal 2': {
    header: 'FF375623',
    row1: 'FFD6EAC8',
    row2: 'FFECF4E3'
  },
  'Abakpa Terminal': {
    header: 'FF7B2D00',
    row1: 'FFF4D3C0',
    row2: 'FFFAEAE0'
  },
  'Gariki Terminal': {
    header: 'FF4A235A',
    row1: 'FFE8D5F0',
    row2: 'FFF5EEF8'
  }
};

// ─── POST: Save a new daily entry ────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      terminal,
      toiletType,
      date,
      day,
      totalAmountPerDay,
      expensesDescription,
      totalExpensesPerDay
    } = req.body;

    const remainingBalancePerDay =
      Number(totalAmountPerDay) - Number(totalExpensesPerDay);

    // Cumulative total is per terminal AND toilet type
    const lastRecord = await Revenue.findOne({
      terminal,
      toiletType
    }).sort({ date: -1 });

    const previousTotal = lastRecord ? lastRecord.cumulativeTotal : 0;
    const cumulativeTotal = previousTotal + remainingBalancePerDay;

    const entry = new Revenue({
      terminal,
      toiletType,
      date,
      day,
      totalAmountPerDay:   Number(totalAmountPerDay),
      expensesDescription,
      totalExpensesPerDay: Number(totalExpensesPerDay),
      remainingBalancePerDay,
      cumulativeTotal
    });

    await entry.save();
    await generateExcelForTerminal(terminal);

    res.status(201).json({
      message: `Entry saved and Excel updated for ${terminal} - ${toiletType}!`,
      entry
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Fetch records (filter by terminal and/or toiletType) ───────────────
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.terminal)   filter.terminal   = req.query.terminal;
    if (req.query.toiletType) filter.toiletType = req.query.toiletType;
    const records = await Revenue.find(filter).sort({ date: 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Summary totals grouped by terminal and toiletType ──────────────────
router.get('/summary', async (req, res) => {
  try {
    const summary = await Revenue.aggregate([
      {
        $group: {
          _id: {
            terminal:   '$terminal',
            toiletType: '$toiletType'
          },
          totalRevenue:  { $sum: '$totalAmountPerDay'      },
          totalExpenses: { $sum: '$totalExpensesPerDay'    },
          totalBalance:  { $sum: '$remainingBalancePerDay' },
          entryCount:    { $sum: 1                         }
        }
      },
      { $sort: { '_id.terminal': 1, '_id.toiletType': 1 } }
    ]);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT: Edit and update an existing record ─────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const {
      date,
      day,
      totalAmountPerDay,
      expensesDescription,
      totalExpensesPerDay
    } = req.body;

    const remainingBalancePerDay =
      Number(totalAmountPerDay) - Number(totalExpensesPerDay);

    const updated = await Revenue.findByIdAndUpdate(
      req.params.id,
      {
        date,
        day,
        totalAmountPerDay:   Number(totalAmountPerDay),
        expensesDescription,
        totalExpensesPerDay: Number(totalExpensesPerDay),
        remainingBalancePerDay
      },
      { new: true }
    );

    if (!updated) return res.status(404).json({ error: 'Record not found' });

    await recalculateCumulative(updated.terminal, updated.toiletType);
    await generateExcelForTerminal(updated.terminal);

    res.json({ message: 'Record updated successfully!', updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE: Remove a record ──────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const record = await Revenue.findById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const { terminal, toiletType } = record;
    await Revenue.findByIdAndDelete(req.params.id);
    await recalculateCumulative(terminal, toiletType);
    await generateExcelForTerminal(terminal);

    res.json({ message: 'Record deleted and Excel updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET: Download Excel for a specific terminal ──────────────────────────────
router.get('/download/:terminal', async (req, res) => {
  try {
    const terminal = decodeURIComponent(req.params.terminal);
    const safeName = terminal.replace(/\s+/g, '_');
    const filePath = path.join(__dirname, '../exports', `${safeName}.xlsx`);
    if (!fs.existsSync(filePath)) {
      await generateExcelForTerminal(terminal);
    }
    res.download(filePath, `${safeName}_Revenue.xlsx`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HELPER: Recalculate cumulative totals ────────────────────────────────────
async function recalculateCumulative(terminal, toiletType) {
  const records = await Revenue.find({
    terminal,
    toiletType
  }).sort({ date: 1 });

  let running = 0;
  for (const record of records) {
    running += record.remainingBalancePerDay;
    await Revenue.findByIdAndUpdate(record._id, {
      cumulativeTotal: running
    });
  }
}

// ─── HELPER: Generate Excel file for a terminal (2 sheets: inside + outside) ─
async function generateExcelForTerminal(terminal) {
  const colors =
    TERMINAL_COLORS[terminal] || TERMINAL_COLORS['Terminal 1'];

  const workbook   = new ExcelJS.Workbook();
  workbook.creator = 'Enugu East Bus Terminal Revenue System';
  workbook.created = new Date();

  const toiletTypes = ['Inside Toilet', 'Outside Toilet'];

  for (const toiletType of toiletTypes) {
    const records = await Revenue.find({
      terminal,
      toiletType
    }).sort({ date: 1 });

    const sheetName = toiletType === 'Inside Toilet'
      ? 'Inside Toilet'
      : 'Outside Toilet';

    const sheet = workbook.addWorksheet(sheetName, {
      pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    // ── Row 1: Title ────────────────────────────────────────────────────────
    sheet.mergeCells('A1:H1');
    const titleCell = sheet.getCell('A1');
    titleCell.value =
      `ENUGU EAST BUS TERMINAL - ${terminal.toUpperCase()} | ${toiletType.toUpperCase()} REVENUE RECORD`;
    titleCell.font = {
      name: 'Arial', bold: true, size: 13,
      color: { argb: 'FFFFFFFF' }
    };
    titleCell.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: colors.header }
    };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 35;

    // ── Row 2: Subtitle ─────────────────────────────────────────────────────
    sheet.mergeCells('A2:H2');
    const subCell    = sheet.getCell('A2');
    subCell.value    = `Generated: ${new Date().toLocaleDateString('en-NG', {
      weekday: 'long', year: 'numeric',
      month: 'long',   day: 'numeric'
    })}`;
    subCell.font      = { name: 'Arial', italic: true, size: 10, color: { argb: 'FF666666' } };
    subCell.alignment = { horizontal: 'center' };
    sheet.getRow(2).height = 20;

    // ── Column widths ────────────────────────────────────────────────────────
    sheet.columns = [
      { key: 'sn',                     width: 6  },
      { key: 'date',                   width: 16 },
      { key: 'day',                    width: 14 },
      { key: 'toiletType',             width: 16 },
      { key: 'totalAmountPerDay',      width: 22 },
      { key: 'expensesDescription',    width: 35 },
      { key: 'totalExpensesPerDay',    width: 22 },
      { key: 'remainingBalancePerDay', width: 22 }
    ];

    // ── Row 3: Headers ───────────────────────────────────────────────────────
    const headers = [
      'S/N', 'Date', 'Day', 'Toilet Type',
      'Total Amount/Day (₦)', 'Expenses Description',
      'Total Expenses/Day (₦)', 'Remaining Balance/Day (₦)'
    ];

    const headerRow = sheet.getRow(3);
    headers.forEach((h, i) => {
      const cell    = headerRow.getCell(i + 1);
      cell.value    = h;
      cell.font     = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill     = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border   = {
        top:    { style: 'thin', color: { argb: 'FFFFFFFF' } },
        left:   { style: 'thin', color: { argb: 'FFFFFFFF' } },
        bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
        right:  { style: 'thin', color: { argb: 'FFFFFFFF' } }
      };
    });
    headerRow.height = 40;

    // ── Data Rows ────────────────────────────────────────────────────────────
    records.forEach((record, index) => {
      const row     = sheet.getRow(index + 4);
      const bgColor = index % 2 === 0 ? colors.row1 : colors.row2;

      const values = [
        index + 1,
        new Date(record.date).toLocaleDateString('en-NG'),
        record.day,
        record.toiletType,
        record.totalAmountPerDay,
        record.expensesDescription,
        record.totalExpensesPerDay,
        record.remainingBalancePerDay
      ];

      values.forEach((val, i) => {
        const cell     = row.getCell(i + 1);
        cell.value     = val;
        cell.font      = { name: 'Arial', size: 10 };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.alignment = {
          vertical:   'middle',
          wrapText:   true,
          horizontal: i === 5 ? 'left' : 'center'
        };
        cell.border = {
          top:    { style: 'hair' },
          left:   { style: 'hair' },
          bottom: { style: 'hair' },
          right:  { style: 'hair' }
        };
        if ([4, 6, 7].includes(i)) cell.numFmt = '₦#,##0.00';
      });

      row.height = 22;
    });

    // ── Totals Row ───────────────────────────────────────────────────────────
    if (records.length > 0) {
      const totalRow = sheet.getRow(records.length + 4);
      const startRow = 4;
      const endRow   = records.length + 3;

      totalRow.getCell(1).value = 'TOTAL';

      totalRow.getCell(5).value  = { formula: `SUM(E${startRow}:E${endRow})` };
      totalRow.getCell(5).numFmt = '₦#,##0.00';

      totalRow.getCell(7).value  = { formula: `SUM(G${startRow}:G${endRow})` };
      totalRow.getCell(7).numFmt = '₦#,##0.00';

      totalRow.getCell(8).value  = { formula: `SUM(H${startRow}:H${endRow})` };
      totalRow.getCell(8).numFmt = '₦#,##0.00';

      for (let i = 1; i <= 8; i++) {
        const cell = totalRow.getCell(i);
        cell.font  = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
        cell.border = {
          top:    { style: 'medium' },
          left:   { style: 'thin'   },
          bottom: { style: 'medium' },
          right:  { style: 'thin'   }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      totalRow.height = 28;
    }
  }

  // ── Save File ────────────────────────────────────────────────────────────
  const exportsDir = path.join(__dirname, '../exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
  }

  const safeName = terminal.replace(/\s+/g, '_');
  const filePath = path.join(exportsDir, `${safeName}.xlsx`);
  await workbook.xlsx.writeFile(filePath);

  console.log(`✅ Excel updated: ${filePath}`);
}




// ─── GET: Download Excel for date range ──────────────────────────────────────
router.get('/download-range', async (req, res) => {
  try {
    const { terminal, toiletType, startDate, endDate } = req.query;

    // Build filter
    const filter = {};
    if (terminal && terminal !== 'All Terminals') filter.terminal   = terminal;
    if (toiletType && toiletType !== 'All')        filter.toiletType = toiletType;

    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.date.$lte = end;
      }
    }

    const records = await Revenue.find(filter).sort({ terminal: 1, date: 1 });

    if (records.length === 0) {
      return res.status(404).json({ error: 'No records found for the selected date range.' });
    }

    // Build Excel
    const workbook   = new ExcelJS.Workbook();
    workbook.creator = 'Enugu East Bus Terminal Revenue System';
    workbook.created = new Date();

    // Group records by terminal and toiletType
    const groups = {};
    records.forEach(r => {
      const key = `${r.terminal} - ${r.toiletType}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    const TERMINAL_COLORS = {
      'Terminal 1':      { header: 'FF1F4E79', row1: 'FFD6E4F0', row2: 'FFEBF4FA' },
      'Terminal 2':      { header: 'FF375623', row1: 'FFD6EAC8', row2: 'FFECF4E3' },
      'Abakpa Terminal': { header: 'FF7B2D00', row1: 'FFF4D3C0', row2: 'FFFAEAE0' },
      'Gariki Terminal': { header: 'FF4A235A', row1: 'FFE8D5F0', row2: 'FFF5EEF8' }
    };

    Object.entries(groups).forEach(([groupName, groupRecords]) => {
      const terminalName = groupRecords[0].terminal;
      const colors = TERMINAL_COLORS[terminalName] || TERMINAL_COLORS['Terminal 1'];

      const sheet = workbook.addWorksheet(groupName, {
        pageSetup: { paperSize: 9, orientation: 'landscape' }
      });

      // Title
      sheet.mergeCells('A1:H1');
      const titleCell = sheet.getCell('A1');
      titleCell.value = `${groupName.toUpperCase()} — ${
        startDate ? new Date(startDate).toLocaleDateString('en-NG') : 'All'
      } to ${
        endDate ? new Date(endDate).toLocaleDateString('en-NG') : 'All'
      }`;
      titleCell.font      = { name: 'Arial', bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
      titleCell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getRow(1).height = 35;

      // Subtitle
      sheet.mergeCells('A2:H2');
      const subCell      = sheet.getCell('A2');
      subCell.value      = `Generated: ${new Date().toLocaleDateString('en-NG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      })}`;
      subCell.font       = { name: 'Arial', italic: true, size: 10, color: { argb: 'FF666666' } };
      subCell.alignment  = { horizontal: 'center' };
      sheet.getRow(2).height = 20;

      // Columns
      sheet.columns = [
        { key: 'sn',                     width: 6  },
        { key: 'date',                   width: 16 },
        { key: 'day',                    width: 14 },
        { key: 'toiletType',             width: 16 },
        { key: 'totalAmountPerDay',      width: 22 },
        { key: 'expensesDescription',    width: 35 },
        { key: 'totalExpensesPerDay',    width: 22 },
        { key: 'remainingBalancePerDay', width: 22 }
      ];

      // Headers
      const headers = [
        'S/N', 'Date', 'Day', 'Toilet Type',
        'Total Amount/Day (₦)', 'Expenses Description',
        'Total Expenses/Day (₦)', 'Remaining Balance/Day (₦)'
      ];

      const headerRow = sheet.getRow(3);
      headers.forEach((h, i) => {
        const cell     = headerRow.getCell(i + 1);
        cell.value     = h;
        cell.font      = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border    = {
          top: { style: 'thin', color: { argb: 'FFFFFFFF' } },
          left: { style: 'thin', color: { argb: 'FFFFFFFF' } },
          bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } },
          right: { style: 'thin', color: { argb: 'FFFFFFFF' } }
        };
      });
      headerRow.height = 40;

      // Data rows
      groupRecords.forEach((record, index) => {
        const row     = sheet.getRow(index + 4);
        const bgColor = index % 2 === 0 ? colors.row1 : colors.row2;
        const values  = [
          index + 1,
          new Date(record.date).toLocaleDateString('en-NG'),
          record.day,
          record.toiletType,
          record.totalAmountPerDay,
          record.expensesDescription,
          record.totalExpensesPerDay,
          record.remainingBalancePerDay
        ];
        values.forEach((val, i) => {
          const cell     = row.getCell(i + 1);
          cell.value     = val;
          cell.font      = { name: 'Arial', size: 10 };
          cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
          cell.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 5 ? 'left' : 'center' };
          cell.border    = { top: { style: 'hair' }, left: { style: 'hair' }, bottom: { style: 'hair' }, right: { style: 'hair' } };
          if ([4, 6, 7].includes(i)) cell.numFmt = '₦#,##0.00';
        });
        row.height = 22;
      });

      // Totals row
      if (groupRecords.length > 0) {
        const totalRow = sheet.getRow(groupRecords.length + 4);
        const startRow = 4;
        const endRow   = groupRecords.length + 3;
        totalRow.getCell(1).value  = 'TOTAL';
        totalRow.getCell(5).value  = { formula: `SUM(E${startRow}:E${endRow})` };
        totalRow.getCell(5).numFmt = '₦#,##0.00';
        totalRow.getCell(7).value  = { formula: `SUM(G${startRow}:G${endRow})` };
        totalRow.getCell(7).numFmt = '₦#,##0.00';
        totalRow.getCell(8).value  = { formula: `SUM(H${startRow}:H${endRow})` };
        totalRow.getCell(8).numFmt = '₦#,##0.00';
        for (let i = 1; i <= 8; i++) {
          const cell  = totalRow.getCell(i);
          cell.font   = { name: 'Arial', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
          cell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.header } };
          cell.border = { top: { style: 'medium' }, left: { style: 'thin' }, bottom: { style: 'medium' }, right: { style: 'thin' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        totalRow.height = 28;
      }
    });

    // Set response headers and stream the file
    const label = terminal && terminal !== 'All Terminals'
      ? terminal.replace(/\s+/g, '_')
      : 'All_Terminals';
    const fromLabel = startDate ? startDate : 'start';
    const toLabel   = endDate   ? endDate   : 'end';
    const fileName  = `${label}_${fromLabel}_to_${toLabel}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;