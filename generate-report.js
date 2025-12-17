const ExcelJS = require('exceljs');

async function generateExcelReport() {
  // 데이터 로드
  const wb1 = new ExcelJS.Workbook();
  await wb1.xlsx.readFile('기간별 수불현황_20251212093053.xlsx');
  const sheet1 = wb1.worksheets[0];

  let salesMap = {};
  for (let i = 3; i <= sheet1.rowCount; i++) {
    const row = sheet1.getRow(i);
    const productCode = String(row.getCell(1).value || '').trim();
    const warehouse = row.getCell(3).value;
    const deliveryQty = Number(row.getCell(7).value) || 0;
    if (productCode && String(warehouse).includes('B2C')) {
      salesMap[productCode] = deliveryQty;
    }
  }

  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.readFile('재고현황_20251212093106.xlsx');
  const sheet2 = wb2.worksheets[0];

  let inventoryData = [];
  for (let i = 3; i <= sheet2.rowCount; i++) {
    const row = sheet2.getRow(i);
    const productName = row.getCell(2).value;
    const productCode = String(row.getCell(3).value || '').trim();
    const location = String(row.getCell(7).value || '');
    const qty = Number(row.getCell(8).value) || 0;
    const colNum = String(row.getCell(12).value || '').padStart(2, '0');
    const level = String(row.getCell(13).value || '').padStart(2, '0');

    if (productCode && location && location.startsWith('CC-')) {
      const sales = salesMap[productCode] || 0;
      const isEasyAccess = ['01', '11', '12'].includes(level);
      inventoryData.push({ productCode, productName, location, qty, col: colNum, level, sales, isEasyAccess });
    }
  }

  // 상품코드별 그룹핑
  const productGroup = {};
  inventoryData.forEach(item => {
    if (!productGroup[item.productCode]) {
      productGroup[item.productCode] = {
        productCode: item.productCode,
        productName: item.productName,
        sales: item.sales,
        locations: [],
        totalQty: 0,
        minCol: 99,
        hasEasyAccess: false,
        easyAccessLocs: []
      };
    }
    productGroup[item.productCode].locations.push({ loc: item.location, qty: item.qty, level: item.level });
    productGroup[item.productCode].totalQty += item.qty;
    productGroup[item.productCode].minCol = Math.min(productGroup[item.productCode].minCol, Number(item.col) || 99);
    if (item.isEasyAccess) {
      productGroup[item.productCode].hasEasyAccess = true;
      productGroup[item.productCode].easyAccessLocs.push({ loc: item.location, qty: item.qty });
    }
  });

  const products = Object.values(productGroup);

  // 리포트 생성
  const reportWb = new ExcelJS.Workbook();

  // 시트1: 1열로 이동 추천
  const sheet1Report = reportWb.addWorksheet('1열로 이동 추천');
  sheet1Report.columns = [
    { header: '순위', key: 'rank', width: 8 },
    { header: '상품코드', key: 'productCode', width: 20 },
    { header: '상품명', key: 'productName', width: 45 },
    { header: '6개월 배송수량', key: 'sales', width: 15 },
    { header: '현재 재고', key: 'qty', width: 12 },
    { header: '현재 최소열', key: 'minCol', width: 12 },
    { header: '현재 위치', key: 'locations', width: 50 },
    { header: '추천 사유', key: 'reason', width: 30 }
  ];

  sheet1Report.getRow(1).font = { bold: true };
  sheet1Report.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  sheet1Report.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const moveToCol1 = products
    .filter(p => p.sales >= 500 && p.minCol > 3)
    .sort((a, b) => b.sales - a.sales);

  moveToCol1.forEach((p, i) => {
    const locs = p.locations.map(l => l.loc + '(' + l.qty + ')').slice(0, 5).join(', ');
    sheet1Report.addRow({
      rank: i + 1,
      productCode: p.productCode,
      productName: p.productName,
      sales: p.sales,
      qty: p.totalQty,
      minCol: p.minCol + '열',
      locations: locs + (p.locations.length > 5 ? ' 외 ' + (p.locations.length - 5) + '곳' : ''),
      reason: '배송량 높음, 1열 근처로 이동 필요'
    });
  });

  // 시트2: 1열에서 이동 추천
  const sheet2Report = reportWb.addWorksheet('1열에서 이동 추천');
  sheet2Report.columns = [
    { header: '순위', key: 'rank', width: 8 },
    { header: '상품코드', key: 'productCode', width: 20 },
    { header: '상품명', key: 'productName', width: 45 },
    { header: '6개월 배송수량', key: 'sales', width: 15 },
    { header: '현재 재고', key: 'qty', width: 12 },
    { header: '현재 위치', key: 'locations', width: 50 },
    { header: '추천 사유', key: 'reason', width: 30 }
  ];

  sheet2Report.getRow(1).font = { bold: true };
  sheet2Report.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFED7D31' } };
  sheet2Report.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const moveFromCol1 = products
    .filter(p => p.sales < 100 && p.minCol <= 1)
    .sort((a, b) => a.sales - b.sales);

  moveFromCol1.forEach((p, i) => {
    const locs = p.locations.map(l => l.loc + '(' + l.qty + ')').join(', ');
    sheet2Report.addRow({
      rank: i + 1,
      productCode: p.productCode,
      productName: p.productName,
      sales: p.sales,
      qty: p.totalQty,
      locations: locs,
      reason: '배송 저조, 먼 곳으로 이동 가능'
    });
  });

  // 시트3: 1단 차지 but 배송 0 (새로 추가)
  const sheet3Report = reportWb.addWorksheet('1단 차지 배송0 상품');
  sheet3Report.columns = [
    { header: '순위', key: 'rank', width: 8 },
    { header: '상품코드', key: 'productCode', width: 20 },
    { header: '상품명', key: 'productName', width: 45 },
    { header: '6개월 배송수량', key: 'sales', width: 15 },
    { header: '현재 재고', key: 'qty', width: 12 },
    { header: '1단 위치', key: 'easyLocs', width: 50 },
    { header: '추천 사유', key: 'reason', width: 35 }
  ];

  sheet3Report.getRow(1).font = { bold: true };
  sheet3Report.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC00000' } };
  sheet3Report.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const noSalesEasyAccess = products
    .filter(p => p.sales === 0 && p.hasEasyAccess)
    .sort((a, b) => b.totalQty - a.totalQty);

  noSalesEasyAccess.forEach((p, i) => {
    const easyLocs = p.easyAccessLocs.map(l => l.loc + '(' + l.qty + ')').slice(0, 5).join(', ');
    sheet3Report.addRow({
      rank: i + 1,
      productCode: p.productCode,
      productName: p.productName,
      sales: p.sales,
      qty: p.totalQty,
      easyLocs: easyLocs + (p.easyAccessLocs.length > 5 ? ' 외' : ''),
      reason: '배송 0건, 1단(01,11,12단) 자리 낭비'
    });
  });

  // 시트4: 전체 배송량 순위
  const sheet4Report = reportWb.addWorksheet('전체 배송량 순위');
  sheet4Report.columns = [
    { header: '순위', key: 'rank', width: 8 },
    { header: '상품코드', key: 'productCode', width: 20 },
    { header: '상품명', key: 'productName', width: 45 },
    { header: '6개월 배송수량', key: 'sales', width: 15 },
    { header: '현재 재고', key: 'qty', width: 12 },
    { header: '현재 최소열', key: 'minCol', width: 12 },
    { header: '현재 위치', key: 'locations', width: 50 }
  ];

  sheet4Report.getRow(1).font = { bold: true };
  sheet4Report.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
  sheet4Report.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  const allBySales = [...products].sort((a, b) => b.sales - a.sales);

  allBySales.forEach((p, i) => {
    const locs = p.locations.map(l => l.loc).slice(0, 3).join(', ');
    sheet4Report.addRow({
      rank: i + 1,
      productCode: p.productCode,
      productName: p.productName,
      sales: p.sales,
      qty: p.totalQty,
      minCol: p.minCol + '열',
      locations: locs + (p.locations.length > 3 ? ' 외' : '')
    });
  });

  // 파일 저장
  const fileName = '로케이션_이동추천_배송기준_v2_' + new Date().toISOString().slice(0,10) + '.xlsx';
  await reportWb.xlsx.writeFile(fileName);
  console.log('리포트 생성 완료: ' + fileName);
  console.log('');
  console.log('시트1 - 1열로 이동 추천: ' + moveToCol1.length + '개 상품');
  console.log('시트2 - 1열에서 이동 추천: ' + moveFromCol1.length + '개 상품');
  console.log('시트3 - 1단 차지 배송0 상품: ' + noSalesEasyAccess.length + '개 상품');
  console.log('시트4 - 전체 배송량 순위: ' + allBySales.length + '개 상품');
}

generateExcelReport().catch(console.error);
