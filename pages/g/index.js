// pages/index.js
import { useState, useEffect } from 'react';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { Calendar, FileUp, Settings } from 'lucide-react';
import AuthLayout from '@/components/AuthLayout';
import supabase from '@/lib/supabase';

export default function Home() {
  // 오늘 날짜를 기본값으로 설정
  const getTodayString = () => {
    const today = new Date();
    return today.toISOString().split('T')[0]; // YYYY-MM-DD 형식
  };

  const getTodayPrefix = () => {
    const today = new Date();
    return `${today.getMonth() + 1}/${today.getDate()}`; // m/d 형식
  };

  const [datePrefix, setDatePrefix] = useState(getTodayPrefix());
  const [selectedDate, setSelectedDate] = useState(getTodayString());
  const [files, setFiles] = useState([]); // 다중 파일 배열로 변경
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [note, setNote] = useState(''); // 참고사항 추가

  // 새로운 옵션들
  const [combineSheets, setCombineSheets] = useState(false); // 시트 통합 여부
  const [sortByLocation, setSortByLocation] = useState(false); // 로케이션 정렬 여부
  const [smartSort, setSmartSort] = useState(false); // 스마트 정렬 여부
  const [manualClientName, setManualClientName] = useState(''); // 수동 업체명 입력
  const [extractedClientName, setExtractedClientName] = useState(''); // 자동 추출된 업체명

  // 스마트 정렬 규칙 (상품명 키워드 그룹)
  // 더 이펙트, 비 네이처는 동일한 크기이므로 같은 그룹으로 묶음
  const smartSortRules = [
    { keywords: ['더 이펙트', '더이펙트', 'THE EFFECT', 'the effect', '비 네이처', '비네이처', 'B NATURE', 'b nature', 'BE NATURE', 'be nature'], group: '01_더이펙트_비네이처' },
    { keywords: ['500ml', '500ML', '500 ml', '500 ML'], group: '02_500ML' },
    { keywords: ['1000ml', '1000ML', '1000 ml', '1000 ML'], group: '03_1000ML' },
  ];

  // 상품명에서 그룹 찾기
  const getSmartSortGroup = (productName) => {
    if (!productName) return 'zzz_기타'; // 기타는 맨 뒤로
    const name = productName.toString();
    for (const rule of smartSortRules) {
      for (const keyword of rule.keywords) {
        if (name.includes(keyword)) {
          return rule.group;
        }
      }
    }
    return 'zzz_기타';
  };

  // 스마트 정렬 함수 (그룹 내 다중로케이션 정렬)
  const applySmartSort = (rows, productCodeIndex, productNameIndex, locationIndex) => {
    console.log('스마트 정렬 시작 - locationIndex:', locationIndex);

    // 각 행에 그룹 정보 추가
    const rowsWithGroup = rows.map((row, idx) => {
      const location = locationIndex !== undefined ? (row[locationIndex] || '').toString() : '';
      console.log(`행 ${idx}: 로케이션=${location}, 상품명=${row[productNameIndex]}`);
      return {
        row,
        group: getSmartSortGroup(row[productNameIndex]),
        productCode: (row[productCodeIndex] || '').toString(),
        location: location
      };
    });

    // 정렬: 1순위 그룹명, 2순위 다중로케이션
    rowsWithGroup.sort((a, b) => {
      // 그룹 비교
      const groupCompare = a.group.localeCompare(b.group);
      if (groupCompare !== 0) return groupCompare;

      // 같은 그룹 내에서 다중로케이션 순
      return a.location.localeCompare(b.location);
    });

    console.log('정렬 후:', rowsWithGroup.map(item => ({ group: item.group, location: item.location })));
    return rowsWithGroup.map(item => item.row);
  };

  // 날짜 선택 시 자동으로 datePrefix 업데이트
  useEffect(() => {
    if (selectedDate) {
      const date = new Date(selectedDate);
      const month = date.getMonth() + 1;
      const day = date.getDate();
      setDatePrefix(`${month}/${day}`);
    }
  }, [selectedDate]);

  const handleFilesChange = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(selectedFiles);
    setError('');
    setSuccess(false);
    setExtractedClientName(''); // 새 파일 선택 시 초기화

    // 첫 번째 파일에서 업체명 미리 추출
    if (selectedFiles.length > 0) {
      try {
        const firstFile = selectedFiles[0];
        const data = await readExcelFile(firstFile);
        const clientName = extractClientNameFromData(data);
        if (clientName) {
          setExtractedClientName(clientName);
        }
      } catch (err) {
        console.error('업체명 추출 오류:', err);
      }
    }
  };

  // 데이터에서 업체명만 추출하는 함수
  const extractClientNameFromData = (data) => {
    if (!data || data.length === 0) return '';

    // 헤더 행 찾기
    let headerRow = -1;
    let clientColumnIndex = -1;

    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (!row) continue;

      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (cell && cell.toString().includes('거래처')) {
          headerRow = i;
          clientColumnIndex = j;
          break;
        }
      }
      if (clientColumnIndex !== -1) break;
    }

    // 거래처 열에서 첫 번째 유효한 값 찾기
    if (clientColumnIndex !== -1 && headerRow !== -1) {
      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];
        if (row && row[clientColumnIndex] && row[clientColumnIndex].toString().trim() !== '') {
          return row[clientColumnIndex].toString().trim();
        }
      }
    }

    return '';
  };

  const processExcel = async (e) => {
    e.preventDefault();

    if (!files.length) {
      setError('파일을 선택해주세요.');
      return;
    }
    if (!datePrefix) {
      setError('날짜를 입력해주세요.');
      return;
    }

    setProcessing(true);
    setError('');
    setSuccess(false);

    try {
      // 모든 파일의 처리 결과를 저장할 배열
      const allProcessedData = [];

      // 통합 패킹리스트를 위한 데이터 수집
      let combinedClientName = '';
      const allProductsForPacking = [];
      const allProductsForStatement = [];

      // 각 파일 처리
      for (const file of files) {
        // 파일 읽기
        const data = await readExcelFile(file);
        console.log(`파일 데이터 (${file.name}):`, data);

        // 데이터 처리 및 거래처명 추출 (정렬 옵션 전달)
        const processResult = processData(data, datePrefix, sortByLocation, smartSort);
        console.log(`처리된 데이터 (${file.name}):`, processResult);

        // 거래처명 설정 (첫 번째 파일의 거래처명 사용)
        if (!combinedClientName && processResult.clientName) {
          combinedClientName = processResult.clientName;
        }

        // 패킹리스트용 제품 데이터 수집
        if (processResult.productsForPacking && processResult.productsForPacking.length > 0) {
          allProductsForPacking.push(...processResult.productsForPacking);
        }

        // 거래명세서용 제품 데이터 수집
        if (processResult.productsForStatement && processResult.productsForStatement.length > 0) {
          allProductsForStatement.push(...processResult.productsForStatement);
        }

        // 처리 결과 저장
        allProcessedData.push({
          fileName: file.name,
          data: processResult.processedData,
          clientName: processResult.clientName,
          productsForStatement: processResult.productsForStatement
        });
      }

      // 날짜 형식 변환 (m/d -> mmdd)
      let formattedDate = formatDateForFileName(datePrefix);

      // 최종 업체명 결정 (수동 입력 우선, 없으면 자동 추출)
      const finalClientName = manualClientName.trim() || combinedClientName;

      // 파일명 생성 (mmdd거래처명.xlsx)
      let fileName = `${formattedDate}${finalClientName || ''}.xlsx`;

      // 파일명이 생성되지 않았거나 거래처명이 없는 경우 기본 파일명 사용
      if (!finalClientName || finalClientName.trim() === '') {
        fileName = `${formattedDate}_처리된_물류데이터.xlsx`;
      }

      // 통합 패킹리스트 데이터 생성 (DB에서 ea/box, 박스당중량 조회)
      const packingListData = await createCombinedPackingList(allProductsForPacking, datePrefix, finalClientName);

      // 다운로드 (ExcelJS 사용) - 시트 통합 옵션 전달
      await downloadMultiSheetExcel(
        allProcessedData,
        packingListData,
        fileName,
        datePrefix,
        finalClientName,
        note,
        combineSheets
      );

      setSuccess(true);
    } catch (err) {
      console.error('Error processing file:', err);
      setError('파일 처리 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 날짜를 mmdd 형식으로 변환하는 함수
  const formatDateForFileName = (dateStr) => {
    try {
      if (!dateStr) return '';
      
      const dateParts = dateStr.split('/');
      if (dateParts.length === 2) {
        const month = dateParts[0].padStart(2, '0');
        const day = dateParts[1].padStart(2, '0');
        return month + day;
      }
      return dateStr;
    } catch (err) {
      console.error('Date formatting error:', err);
      return dateStr;
    }
  };

  const readExcelFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { 
            type: 'array',
            cellStyles: true,
            cellDates: true 
          });
          
          // 첫 번째 시트 사용
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // 시트의 데이터를 배열로 변환
          const sheetData = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1,
            defval: '',
            blankrows: true 
          });
          
          resolve(sheetData);
        } catch (err) {
          reject(err);
        }
      };
      
      reader.onerror = (err) => {
        reject(err);
      };
      
      reader.readAsArrayBuffer(file);
    });
  };

  const processData = (data, datePrefix, shouldSortByLocation = false, shouldSmartSort = false) => {
    try {
      if (!data || !Array.isArray(data) || data.length < 2) {
        throw new Error('파일 형식이 올바르지 않습니다. 최소 2행이 필요합니다.');
      }

      // 거래처 정보는 거래처 열에서 첫 번째 유효한 값을 사용
      let clientName = '';

      // 헤더는 2행(인덱스 1)으로 고정
      const headerRow = 1;

      // 찾을 컬럼 목록 (첫 번째 시트용)
      const columnsToFind = [
        '상품코드', '상품명', '유통기한', 'lot', '정상수량', '다중로케이션', '바코드' // 바코드 컬럼 추가
      ];

      // 거래처 열은 파일명과 1행을 위해 별도로 찾음
      let clientColumnIndex = -1;

      // 헤더 행에서 필요한 컬럼 인덱스 찾기
      const headerIndexMap = {};
      const headerRow_data = data[headerRow] || [];

      if (!headerRow_data || !Array.isArray(headerRow_data)) {
        console.error('헤더 행이 유효하지 않습니다:', headerRow_data);
        throw new Error('엑셀 파일의 헤더 행이 유효하지 않습니다.');
      }

      for (let i = 0; i < headerRow_data.length; i++) {
        const cellValue = headerRow_data[i];
        if (cellValue) {
          const cellValueStr = cellValue.toString().toLowerCase();

          // 거래처 열 인덱스 별도 저장
          if (cellValueStr.includes('거래처')) {
            clientColumnIndex = i;
          }

          // 다른 컬럼 매핑
          const foundColumn = columnsToFind.find(col =>
            cellValueStr.includes(col.toLowerCase())
          );
          if (foundColumn) {
            headerIndexMap[foundColumn] = i;
          }
        }
      }

      // 거래처 열의 인덱스 찾기
      const normalQuantityIndex = headerIndexMap['정상수량'];
      const locationIndex = headerIndexMap['다중로케이션'];

      // 먼저 데이터를 한 번 순회해서 거래처 이름 가져오기
      if (clientColumnIndex !== -1) {
        for (let i = headerRow + 1; i < data.length; i++) {
          const row = data[i];
          if (row && row[clientColumnIndex] && row[clientColumnIndex].toString().trim() !== '') {
            clientName = row[clientColumnIndex].toString().trim();
            console.log('거래처명 찾음:', clientName);
            break;
          }
        }
      }

      // 로케이션 정렬이 필요한 경우 데이터 정렬
      let sortedData = [...data];
      if (shouldSortByLocation && locationIndex !== undefined) {
        const headerAndAbove = sortedData.slice(0, headerRow + 1);
        const dataRows = sortedData.slice(headerRow + 1);

        // 합계 행 찾기 - 다양한 조건으로 판별
        const totalRowIndex = dataRows.findIndex(row => {
          if (!row || !Array.isArray(row)) return false;

          // 조건 1: 첫 번째 셀이 '합계'인 경우
          if (row[0] && row[0].toString().trim() === '합계') return true;

          // 조건 2: 상품코드 열이 비어있고 정상수량만 있는 경우 (마지막 행일 가능성 높음)
          const productCodeIndex = headerIndexMap['상품코드'];
          if (productCodeIndex !== undefined && normalQuantityIndex !== undefined) {
            const hasNoProductCode = !row[productCodeIndex] || row[productCodeIndex].toString().trim() === '';
            const hasQuantity = row[normalQuantityIndex] && parseFloat(row[normalQuantityIndex]) > 0;
            if (hasNoProductCode && hasQuantity) return true;
          }

          return false;
        });

        let totalRow = null;
        let rowsToSort = dataRows;

        if (totalRowIndex !== -1) {
          // 합계 행이 있으면 분리
          totalRow = dataRows[totalRowIndex];
          rowsToSort = dataRows.filter((_, idx) => idx !== totalRowIndex);
        }

        // 데이터 행만 정렬 (빈 행 제외)
        const validRows = rowsToSort.filter(row => row && Array.isArray(row) && row.some(cell => cell));
        validRows.sort((a, b) => {
          const locA = (a[locationIndex] || '').toString().trim();
          const locB = (b[locationIndex] || '').toString().trim();
          return locA.localeCompare(locB);
        });

        // 합계 행을 마지막에 추가
        if (totalRow) {
          sortedData = [...headerAndAbove, ...validRows, totalRow];
        } else {
          sortedData = [...headerAndAbove, ...validRows];
        }
      }

      // 스마트 정렬 적용 (상품명 키워드 그룹화 + 같은 상품코드 연속 배치 + 다중로케이션 정렬)
      if (shouldSmartSort) {
        const headerAndAbove = sortedData.slice(0, headerRow + 1);
        const dataRows = sortedData.slice(headerRow + 1);

        // 합계 행 분리
        const productCodeIndex = headerIndexMap['상품코드'];
        const productNameIndex = headerIndexMap['상품명'];

        const totalRowIndex = dataRows.findIndex(row => {
          if (!row || !Array.isArray(row)) return false;
          if (row[0] && row[0].toString().trim() === '합계') return true;
          const hasNoProductCode = !row[productCodeIndex] || row[productCodeIndex].toString().trim() === '';
          const hasQuantity = row[normalQuantityIndex] && parseFloat(row[normalQuantityIndex]) > 0;
          if (hasNoProductCode && hasQuantity) return true;
          return false;
        });

        let totalRow = null;
        let rowsToSort = dataRows;

        if (totalRowIndex !== -1) {
          totalRow = dataRows[totalRowIndex];
          rowsToSort = dataRows.filter((_, idx) => idx !== totalRowIndex);
        }

        // 빈 행 제외 후 스마트 정렬 적용 (다중로케이션 인덱스 전달)
        const validRows = rowsToSort.filter(row => row && Array.isArray(row) && row.some(cell => cell));
        const smartSortedRows = applySmartSort(validRows, productCodeIndex, productNameIndex, locationIndex);

        if (totalRow) {
          sortedData = [...headerAndAbove, ...smartSortedRows, totalRow];
        } else {
          sortedData = [...headerAndAbove, ...smartSortedRows];
        }
      }

      // 첫 번째 시트 데이터 생성
      const sheet1Data = createFirstSheetData(sortedData, headerRow, headerIndexMap, datePrefix, clientName, normalQuantityIndex);

      // 패킹리스트용 제품 데이터 수집
      const productsForPacking = [];
      const productsForStatement = [];

      // 데이터 행 순회 (헤더 다음 행부터)
      for (let i = headerRow + 1; i < sortedData.length; i++) {
        const row = sortedData[i];

        // 빈 행이면 건너뛰기
        if (!row || !Array.isArray(row) || row.every(cell => !cell)) continue;

        // 정상수량이 0인 행은 건너뛰기
        if (normalQuantityIndex !== undefined) {
          const quantity = row[normalQuantityIndex];
          if (quantity === 0 || quantity === '0') continue;
        }

        // 필요한 값 추출
        const productCode = headerIndexMap['상품코드'] !== undefined ? (row[headerIndexMap['상품코드']] || '') : '';
        const productName = headerIndexMap['상품명'] !== undefined ? (row[headerIndexMap['상품명']] || '') : '';
        const quantity = normalQuantityIndex !== undefined ? (parseFloat(row[normalQuantityIndex]) || 0) : 0;
        const lotNum = headerIndexMap['lot'] !== undefined ? (row[headerIndexMap['lot']] || '') : '';
        const expiryDate = headerIndexMap['유통기한'] !== undefined ? (row[headerIndexMap['유통기한']] || '') : '';
        const location = locationIndex !== undefined ? (row[locationIndex] || '') : '';

        // 바코드 값 가져오기 (바코드 컬럼이 있으면 그것을 사용, 없으면 상품코드를 사용)
        const barcode = headerIndexMap['바코드'] !== undefined ?
          (row[headerIndexMap['바코드']] || productCode) :
          productCode;

        // 합계 행인지 확인 (상품명이 "합계"를 포함하거나, 상품코드는 없고 수량만 있는 경우)
        const isTotal =
          (productName && productName.toString().includes('합계')) ||
          (!productCode && quantity > 0);

        // 패킹리스트 데이터 추가
        productsForPacking.push({
          productCode,
          productName,
          quantity,
          lotNum,
          expiryDate,
          location,
          isTotal // 합계 행 표시
        });

        // 합계 행이 아닌 경우만 거래명세서 데이터에 추가
        if (!isTotal) {
          productsForStatement.push({
            productCode,
            productName,
            barcode,
            quantity
          });
        }
      }

      return {
        processedData: sheet1Data,
        clientName,
        productsForPacking,
        productsForStatement
      };
    } catch (error) {
      console.error('Error in processData:', error);
      throw error; // 오류를 호출자에게 전파
    }
  };

  // 첫 번째 시트 데이터 생성 함수
  const createFirstSheetData = (data, headerRow, headerIndexMap, datePrefix, clientName, normalQuantityIndex) => {
    try {
      // 데이터 유효성 검사
      if (!data || !Array.isArray(data) || !headerIndexMap) {
        console.error('Invalid data or headerIndexMap in createFirstSheetData', { data, headerIndexMap });
        return [[]]; // 오류 시 빈 배열 반환
      }
      
      // 새로운 헤더 행 만들기 (거래처와 바코드 제외)
      const newHeaders = ['상품코드', '상품명', '유통기한', 'LOT', '다중로케이션', '정상수량']
        .filter(col => {
          // 대문자 LOT은 소문자 lot으로 headerIndexMap에서 찾아야 함
          if (col === 'LOT') return headerIndexMap['lot'] !== undefined;
          return headerIndexMap[col] !== undefined;
        });
      
      // 새 데이터 만들기
      const newData = [];
      
      // 첫 번째 행 추가 (거래처 정보)
      if (datePrefix && clientName) {
        newData.push([`${datePrefix} ${clientName}`]);
      } else {
        newData.push(['']); // 날짜나 거래처명이 없는 경우 빈 행 추가
      }
      
      // 헤더 행 추가
      newData.push(newHeaders);
      
      // 데이터 행 추가 (헤더 다음 행부터)
      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];

        // 빈 행이면 건너뛰기
        if (!row || !Array.isArray(row) || row.every(cell => !cell)) continue;
        
        // 정상수량이 0인 행은 건너뛰기
        if (normalQuantityIndex !== undefined) {
          const quantity = row[normalQuantityIndex];
          if (quantity === 0 || quantity === '0') continue;
        }

        const newRow = newHeaders.map(col => {
          // 대문자 LOT은 소문자 lot으로 headerIndexMap에서 찾아야 함
          const colName = col === 'LOT' ? 'lot' : col;
          const colIndex = headerIndexMap[colName];
          return (colIndex !== undefined && row[colIndex] !== undefined) ? row[colIndex] || '' : '';
        });
        
        // 최소한 하나의 셀에 데이터가 있으면 행 추가
        if (newRow.some(cell => cell)) {
          newData.push(newRow);
        }
      }
      
      return newData;
    } catch (error) {
      console.error('Error in createFirstSheetData:', error);
      return [['오류가 발생했습니다']]; // 오류 발생 시 최소한의 데이터 반환
    }
  };

  // 통합 패킹리스트 데이터 생성 함수 (상품 합치지 않음)
  const createCombinedPackingList = async (products, datePrefix, clientName) => {
    try {
      // 패킹리스트 헤더
      const packingHeaders = [
        'plt.no', '상품코드', '상품명', 'ea/box', '박스수', '수량', '박스당중량', '제조번호', '유통기한'
      ];

      // 새 데이터 만들기
      const newData = [];

      // 첫 번째 행 추가 (패킹리스트)
      if (datePrefix && clientName) {
        newData.push([`${datePrefix} ${clientName} 패킹리스트`]);
      } else {
        newData.push(['패킹리스트']); // 날짜나 거래처명이 없는 경우 기본값
      }

      // 헤더 행 추가
      newData.push(packingHeaders);

      // DB에서 상품 정보 조회 (ea_per_box, weight_per_box)
      const productCodes = products
        .filter(p => !p.isTotal && p.productCode)
        .map(p => p.productCode);

      let productInfoMap = {};
      if (productCodes.length > 0) {
        const { data: productData, error: dbError } = await supabase
          .from('products')
          .select('product_code, ea_per_box, weight_per_box')
          .in('product_code', productCodes);

        if (!dbError && productData) {
          productData.forEach(p => {
            productInfoMap[p.product_code] = {
              eaPerBox: p.ea_per_box,
              weightPerBox: p.weight_per_box
            };
          });
        }
      }

      // 총 수량 계산을 위한 변수
      let totalQuantity = 0;

      // 각 제품 데이터를 그대로 추가 (합계 행만 제외하고 처리)
      products.forEach(product => {
        // 합계 행 제외 (product.isTotal이 true인 경우 건너뛰기)
        if (product.isTotal) {
          return;
        }

        const newRow = new Array(packingHeaders.length).fill('');

        // DB에서 가져온 상품 정보
        const productInfo = productInfoMap[product.productCode] || {};
        const eaPerBox = productInfo.eaPerBox;
        const weightPerBox = productInfo.weightPerBox;

        // plt.no는 빈칸으로 둠
        newRow[1] = product.productCode; // 상품코드
        newRow[2] = product.productName; // 상품명
        newRow[3] = eaPerBox || ''; // ea/box (DB에서 조회)

        // 박스수 계산: 수량 / ea/box (ea/box가 있을 때만)
        if (eaPerBox && product.quantity) {
          newRow[4] = Math.ceil(product.quantity / eaPerBox); // 박스수 (올림)
        }

        newRow[5] = product.quantity; // 수량
        newRow[6] = weightPerBox || ''; // 박스당중량 (DB에서 조회)
        newRow[7] = product.lotNum; // 제조번호
        newRow[8] = product.expiryDate; // 유통기한

        newData.push(newRow);

        // 총 수량 계산
        totalQuantity += product.quantity;
      });

      // 합계 행 추가 (항상 마지막에 한 번만 추가)
      if (products.length > 0) {
        const totalRow = new Array(packingHeaders.length).fill('');
        totalRow[2] = '합계';
        totalRow[5] = totalQuantity; // 수량 합계

        newData.push(totalRow);
      }

      return newData;
    } catch (error) {
      console.error('Error in createCombinedPackingList:', error);
      return [['패킹리스트'], ['오류가 발생했습니다']]; // 오류 발생 시 최소한의 데이터 반환
    }
  };

  // 거래명세서 시트 생성 함수 (수정됨)
  const createTransactionStatementSheet = (workbook, products, datePrefix, clientName) => {
    try {
      // 새 워크시트 추가
      const transactionSheet = workbook.addWorksheet('거래명세서');
      
      // A4 세로 방향 페이지 설정 - 한 페이지에 시트 맞추기
      transactionSheet.pageSetup = {
        paperSize: 9, // A4 용지
        orientation: 'portrait', // 세로 방향
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1, // 한 페이지에 맞추기
      };

      // 페이지 번호 푸터 설정 (예: 1/3)
      transactionSheet.headerFooter = {
        oddFooter: '&C&P/&N'
      };
      
      // 날짜 포맷 변환 (예: 3/31 → 2025-03-31)
      let formattedFullDate = '2025-01-01'; // 기본값
      
      try {
        if (datePrefix) {
          const dateParts = datePrefix.split('/');
          if (dateParts.length === 2) {
            const month = dateParts[0].padStart(2, '0');
            const day = dateParts[1].padStart(2, '0');
            formattedFullDate = `2025-${month}-${day}`;
          }
        }
      } catch (err) {
        console.error('Date formatting error:', err);
      }
      
      // 중복 제품 통합 (거래명세서는 상품을 합침)
      const combinedProducts = {};
      
      products.forEach(product => {
        const key = `${product.productCode}_${product.productName}`;
        
        if (!combinedProducts[key]) {
          combinedProducts[key] = {
            productCode: product.productCode,
            productName: product.productName,
            barcode: product.barcode, // 바코드 정보 유지
            quantity: product.quantity
          };
        } else {
          combinedProducts[key].quantity += product.quantity;
        }
      });
      
      // 통합된 제품 데이터를 배열로 변환
      const combinedProductArray = Object.values(combinedProducts);
      
      // 총 수량 계산
      let totalQuantity = 0;
      combinedProductArray.forEach(product => {
        totalQuantity += product.quantity;
      });
      
      // --- 거래명세서 레이아웃 구성 ---
      
      // 제목 행 추가
      const titleRow = transactionSheet.addRow(['거 래 명 세 서']);
      titleRow.font = { 
        name: 'Gulim', // 굴림체
        size: 20, 
        bold: true 
      };
      titleRow.height = 35;
      
      // 셀 병합 및 가운데 정렬
      transactionSheet.mergeCells('A1:D1');
      titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
      
      // 거래처 정보 테이블
      transactionSheet.addRow([]); // 빈 행 추가
      
      // 1행: 거래처, 담당자 (반반 나누기)
      const clientRow = transactionSheet.addRow(['거 래 처', clientName || '', '담 당 자', '']);
      clientRow.height = 25;
      styleHeaderCell(clientRow.getCell(1));
      styleHeaderCell(clientRow.getCell(3));
      styleDataCell(clientRow.getCell(2));
      styleDataCell(clientRow.getCell(4));
      
      // 2행: 일자, 담당연락처
      const dateRow = transactionSheet.addRow(['일 자', formattedFullDate, '담당연락처', '']);
      dateRow.height = 25;
      styleHeaderCell(dateRow.getCell(1));
      styleHeaderCell(dateRow.getCell(3));
      styleDataCell(dateRow.getCell(2));
      styleDataCell(dateRow.getCell(4));
      
      // 3행: 정산 일자, 주소
      const settlementRow = transactionSheet.addRow(['정산 일자', formattedFullDate, '주 소', '']);
      settlementRow.height = 25;
      styleHeaderCell(settlementRow.getCell(1));
      styleHeaderCell(settlementRow.getCell(3));
      styleDataCell(settlementRow.getCell(2));
      styleDataCell(settlementRow.getCell(4));
      
      // 4행: 구분, 참고사항
      const typeRow = transactionSheet.addRow(['구 분', '반출 (일반)', '참고 사항', '']);
      typeRow.height = 25;
      styleHeaderCell(typeRow.getCell(1));
      styleHeaderCell(typeRow.getCell(3));
      styleDataCell(typeRow.getCell(2));
      styleDataCell(typeRow.getCell(4));
      
      // 5행: 전표 번호
      const voucherRow = transactionSheet.addRow(['전표 번호', '', '', '']);
      voucherRow.height = 25;
      styleHeaderCell(voucherRow.getCell(1));
      transactionSheet.mergeCells(`B${voucherRow.number}:D${voucherRow.number}`);
      styleDataCell(voucherRow.getCell(2));
      
      // 6행: 입고 메모
      const memoRow = transactionSheet.addRow(['입고 메모', '', '', '']);
      memoRow.height = 35; // 높이 더 높게
      styleHeaderCell(memoRow.getCell(1));
      transactionSheet.mergeCells(`B${memoRow.number}:D${memoRow.number}`);
      styleDataCell(memoRow.getCell(2));
      
      // 7행: 박스 번호
      const boxRow = transactionSheet.addRow(['박스 번호', '', '', '']);
      boxRow.height = 25;
      styleHeaderCell(boxRow.getCell(1));
      transactionSheet.mergeCells(`B${boxRow.number}:D${boxRow.number}`);
      styleDataCell(boxRow.getCell(2));
      
      // 빈 행 추가
      transactionSheet.addRow([]);
      
      // 상품 목록 테이블 헤더
      const itemsHeaderRow = transactionSheet.addRow(['상품코드', '상품명', '바코드', '합계 수량']);
      itemsHeaderRow.height = 25;
      itemsHeaderRow.eachCell((cell) => {
        styleHeaderCell(cell);
      });
      
      // 상품 데이터 행 추가 (숫자로 저장)
      combinedProductArray.forEach(product => {
        const itemRow = transactionSheet.addRow([
          product.productCode, 
          product.productName, 
          product.barcode, 
          Number(product.quantity) // 숫자로 저장
        ]);
        
        // 첫 번째 열은 가운데 정렬
        const codeCell = itemRow.getCell(1);
        codeCell.alignment = { horizontal: 'center', vertical: 'middle' };
        styleDataCell(codeCell);
        
        // 두 번째 열은 왼쪽 정렬
        const nameCell = itemRow.getCell(2);
        nameCell.alignment = { horizontal: 'left', vertical: 'middle' };
        styleDataCell(nameCell);
        
        // 세 번째 열은 가운데 정렬
        const barcodeCell = itemRow.getCell(3);
        barcodeCell.alignment = { horizontal: 'center', vertical: 'middle' };
        styleDataCell(barcodeCell);
        
        // 네 번째 열은 오른쪽 정렬 및 수량 진하게 처리
        const quantityCell = itemRow.getCell(4);
        quantityCell.alignment = { horizontal: 'right', vertical: 'middle' };
        quantityCell.font = { bold: true }; // 수량도 진하게 처리
        quantityCell.numFmt = '#,##0'; // 천단위 구분자 형식
        styleDataCell(quantityCell);
      });
      
      // 합계 행 추가 (숫자로 저장)
      const totalRow = transactionSheet.addRow(['', '합계', '', Number(totalQuantity)]);

      // 합계 행 스타일 지정
      const emptyCell1 = totalRow.getCell(1);
      emptyCell1.alignment = { horizontal: 'center', vertical: 'middle' };
      styleTotalCell(emptyCell1);

      const totalLabelCell = totalRow.getCell(2);
      totalLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };
      styleTotalCell(totalLabelCell);
      totalLabelCell.font = { name: 'Arial', bold: true }; // styleTotalCell 호출 후 폰트 설정

      const emptyCell2 = totalRow.getCell(3);
      emptyCell2.alignment = { horizontal: 'center', vertical: 'middle' };
      styleTotalCell(emptyCell2);

      const totalValueCell = totalRow.getCell(4);
      totalValueCell.alignment = { horizontal: 'right', vertical: 'middle' };
      totalValueCell.numFmt = '#,##0'; // 천단위 구분자 형식
      styleTotalCell(totalValueCell);
      totalValueCell.font = { name: 'Arial', bold: true }; // styleTotalCell 호출 후 폰트 설정
      
      // 열 너비 조정 - 상품 테이블에 맞게 조정
      transactionSheet.getColumn('A').width = 15;  // 상품코드 넓히기 (12 → 15)
      transactionSheet.getColumn('B').width = 45;  // 상품명 더 넓히기 (35 → 45)
      transactionSheet.getColumn('C').width = 15;  // 바코드
      transactionSheet.getColumn('D').width = 25;  // 수량
      
      // 각종 셀 스타일 적용 함수
      function styleHeaderCell(cell) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFD3D3D3' } // 연한 회색
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.font = { 
          name: 'Arial', // Arial 폰트
          bold: true 
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
      
      function styleDataCell(cell) {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.font = { 
          name: 'Arial' // Arial 폰트
        };
        cell.alignment = { vertical: 'middle' };
      }
      
      function styleTotalCell(cell) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6E6E6' } // 매우 연한 회색
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.font = { 
          name: 'Arial' // Arial 폰트
        };
      }
      
      return transactionSheet;
    } catch (error) {
      console.error('Error creating transaction statement sheet:', error);
      // 오류 발생 시 기본 시트 반환
      const errorSheet = workbook.addWorksheet('거래명세서');
      errorSheet.addRow(['오류가 발생했습니다']);
      errorSheet.addRow([error.message]);
      return errorSheet;
    }
  };

  // 검수지 시트 생성 함수 (피킹지에서 다중로케이션 제외, 상품코드+유통기한+LOT 동일 시 수량 합산)
  const createInspectionSheet = (workbook, processedFiles, datePrefix, clientName) => {
    try {
      const inspectionSheet = workbook.addWorksheet('검수지');

      // A4 가로 방향 페이지 설정
      inspectionSheet.pageSetup = {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      };

      inspectionSheet.headerFooter = {
        oddFooter: '&C&P/&N'
      };

      // 제목 행 추가
      const titleRow = inspectionSheet.addRow([`${datePrefix} ${clientName} 검수지`]);
      titleRow.font = { size: 16, bold: true };
      titleRow.height = 30;

      // 헤더 (다중로케이션 제외)
      const headers = ['상품코드', '상품명', '유통기한', 'LOT', '정상수량'];
      const headerRow = inspectionSheet.addRow(headers);
      headerRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6E6E6' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      // 모든 파일의 데이터를 합쳐서 상품코드+유통기한+LOT 기준으로 그룹화
      const groupedData = new Map();

      processedFiles.forEach(processedFile => {
        const data = processedFile.data;
        if (!data || data.length < 3) return; // 제목행, 헤더행, 데이터행 필요

        // 헤더 인덱스 찾기
        const fileHeaders = data[1];
        const productCodeIdx = fileHeaders.findIndex(h => h === '상품코드');
        const productNameIdx = fileHeaders.findIndex(h => h === '상품명');
        const expiryIdx = fileHeaders.findIndex(h => h === '유통기한');
        const lotIdx = fileHeaders.findIndex(h => h === 'LOT');
        const quantityIdx = fileHeaders.findIndex(h => h === '정상수량');

        // 데이터 행 처리 (인덱스 2부터)
        for (let i = 2; i < data.length; i++) {
          const row = data[i];
          if (!row || row.every(cell => !cell)) continue;

          const productCode = productCodeIdx !== -1 ? (row[productCodeIdx] || '') : '';
          const productName = productNameIdx !== -1 ? (row[productNameIdx] || '') : '';
          const expiryDate = expiryIdx !== -1 ? (row[expiryIdx] || '') : '';
          const lot = lotIdx !== -1 ? (row[lotIdx] || '') : '';
          const quantity = quantityIdx !== -1 ? (parseFloat(row[quantityIdx]) || 0) : 0;

          // 빈 상품코드는 건너뛰기 (합계 행 등)
          if (!productCode) continue;

          // 키: 상품코드 + 유통기한 + LOT
          const key = `${productCode}|||${expiryDate}|||${lot}`;

          if (groupedData.has(key)) {
            const existing = groupedData.get(key);
            existing.quantity += quantity;
          } else {
            groupedData.set(key, {
              productCode,
              productName,
              expiryDate,
              lot,
              quantity
            });
          }
        }
      });

      // 상품코드 기준으로 정렬
      const sortedData = Array.from(groupedData.values()).sort((a, b) => {
        return a.productCode.localeCompare(b.productCode);
      });

      // 총 수량 계산
      let totalQuantity = 0;

      // 데이터 행 추가
      sortedData.forEach(item => {
        const rowData = inspectionSheet.addRow([
          item.productCode,
          item.productName,
          item.expiryDate,
          item.lot,
          item.quantity
        ]);

        totalQuantity += item.quantity;

        // 수량 열에 천단위 구분자
        const quantityCell = rowData.getCell(5);
        if (typeof item.quantity === 'number') {
          quantityCell.numFmt = '#,##0';
        }

        // 유통기한 하이라이트 (2027년 미만)
        const expiryCell = rowData.getCell(3);
        const expiryStr = String(item.expiryDate);
        const year = parseInt(expiryStr.substring(0, 4));
        if (!isNaN(year) && year < 2027) {
          expiryCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFF00' }
          };
        }

        rowData.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });

      // 합계 행 추가
      const totalRow = inspectionSheet.addRow(['', '합계', '', '', totalQuantity]);
      totalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6E6E6' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        if (colNumber === 5) {
          cell.numFmt = '#,##0';
        }
      });

      // 열 너비 조정
      inspectionSheet.getColumn(1).width = 15; // 상품코드
      inspectionSheet.getColumn(2).width = 65; // 상품명
      inspectionSheet.getColumn(3).width = 12; // 유통기한
      inspectionSheet.getColumn(4).width = 12; // LOT
      inspectionSheet.getColumn(5).width = 12; // 정상수량

      return inspectionSheet;
    } catch (error) {
      console.error('Error creating inspection sheet:', error);
      const errorSheet = workbook.addWorksheet('검수지');
      errorSheet.addRow(['오류가 발생했습니다']);
      errorSheet.addRow([error.message]);
      return errorSheet;
    }
  };

  // 여러 시트가 있는 엑셀 파일 다운로드 함수
  const downloadMultiSheetExcel = async (
    processedFiles,
    packingListData,
    fileName,
    datePrefix,
    clientName,
    note,
    combineIntoOneSheet = false
  ) => {
    try {
      // 데이터 유효성 검사
      if (!processedFiles || !Array.isArray(processedFiles) || processedFiles.length === 0) {
        console.error('Invalid processed files data for Excel', processedFiles);
        throw new Error('엑셀 파일을 생성할 수 없습니다: 처리된 파일이 없습니다.');
      }
      
      // ExcelJS 워크북 생성
      const workbook = new ExcelJS.Workbook();
      workbook.creator = '물류 엑셀 프로세서';
      workbook.created = new Date();
      
      // 메타데이터 설정
      workbook.properties.title = `${clientName || '물류'} 데이터`;
      workbook.properties.subject = '피킹 및 패킹 데이터';
      workbook.properties.category = '업무용';
      workbook.properties.status = 'Final';

      // 시트 통합 옵션에 따라 처리
      if (combineIntoOneSheet && processedFiles.length > 1) {
        // 하나의 시트에 모든 전표를 행으로 구분하여 추가
        const sheet = workbook.addWorksheet('피킹지');

        // A4 가로 방향 페이지 설정
        sheet.pageSetup = {
          paperSize: 9,
          orientation: 'landscape',
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        };

        // 페이지 번호 푸터 설정 (예: 1/3)
        sheet.headerFooter = {
          oddFooter: '&C&P/&N'
        };

        for (let i = 0; i < processedFiles.length; i++) {
          const processedFile = processedFiles[i];

          // 전표 구분선 (첫 번째가 아닌 경우)
          if (i > 0) {
            sheet.addRow([]); // 빈 행 추가
          }

          // 제목 행 추가 (수동 입력 업체명 우선 사용)
          const titleRow = sheet.addRow([`${datePrefix} ${clientName || processedFile.clientName}`]);
          titleRow.font = {
            size: 16,
            bold: true
          };
          titleRow.height = 30;

          // 헤더 행 추가
          if (processedFile.data.length > 1) {
            const headerRow = sheet.addRow(processedFile.data[1]);
            headerRow.eachCell((cell) => {
              cell.font = { bold: true };
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE6E6E6' }
              };
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
              };
              cell.alignment = { vertical: 'middle', horizontal: 'center' };
            });
          }

          // 데이터 행 추가
          for (let j = 2; j < processedFile.data.length; j++) {
            const rowData = sheet.addRow(processedFile.data[j]);

            // 수량 열에 천단위 구분자 적용 (숫자 포맷 사용)
            if (processedFile.data[1]) {
              const headers = processedFile.data[1];
              const quantityIndex = headers.findIndex(header => header === '정상수량');
              if (quantityIndex !== -1 && processedFile.data[j][quantityIndex]) {
                const quantityCell = rowData.getCell(quantityIndex + 1);
                const quantityValue = processedFile.data[j][quantityIndex];
                if (typeof quantityValue === 'number' && !isNaN(quantityValue)) {
                  quantityCell.value = Number(quantityValue); // 숫자로 저장
                  quantityCell.numFmt = '#,##0'; // 천단위 구분자 포맷 적용
                }
              }

              // 유통기한 확인 및 하이라이트
              const expiryIndex = headers.findIndex(header => header === '유통기한');
              if (expiryIndex !== -1 && processedFile.data[j][expiryIndex]) {
                const expiryCell = rowData.getCell(expiryIndex + 1);
                const expiryValue = processedFile.data[j][expiryIndex];

                const expiryStr = String(expiryValue);
                const year = parseInt(expiryStr.substring(0, 4));

                if (!isNaN(year) && year < 2027) {
                  expiryCell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFFF00' }
                  };
                }
              }
            }

            // 마지막 행인 경우 굵게 표시
            if (j === processedFile.data.length - 1) {
              rowData.eachCell((cell) => {
                cell.font = { bold: true };
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFE6E6E6' }
                };
                cell.border = {
                  top: { style: 'thin' },
                  left: { style: 'thin' },
                  bottom: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });
            } else {
              rowData.eachCell((cell) => {
                cell.border = {
                  top: { style: 'thin' },
                  left: { style: 'thin' },
                  bottom: { style: 'thin' },
                  right: { style: 'thin' }
                };
              });
            }
          }
        }

        // 열 너비 조정 (첫 번째 파일의 헤더 기준)
        if (processedFiles.length > 0 && processedFiles[0].data.length > 1) {
          sheet.columns.forEach((column, index) => {
            const headerValue = processedFiles[0].data[1][index];
            if (headerValue === '상품명') {
              column.width = 65;
            } else if (headerValue === '상품코드') {
              column.width = 15;
            } else {
              column.width = 12;
            }
          });
        }
      } else {
        // 각 파일별로 피킹지 시트 생성 (기존 방식)
        for (let i = 0; i < processedFiles.length; i++) {
          const processedFile = processedFiles[i];
          const sheetName = processedFiles.length === 1 ? '피킹지' : `피킹지 ${i + 1}`;

          const sheet = workbook.addWorksheet(sheetName);
        
        // A4 가로 방향 페이지 설정 추가
        sheet.pageSetup = {
          paperSize: 9, // A4 용지 (9는 A4를 의미함)
          orientation: 'landscape', // 가로 방향
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        };

        // 페이지 번호 푸터 설정 (예: 1/3)
        sheet.headerFooter = {
          oddFooter: '&C&P/&N'  // 가운데 정렬, 현재페이지/전체페이지
        };

        // 제목 행 추가 (수동 입력 업체명 우선 사용)
        const titleRow = sheet.addRow([`${datePrefix} ${clientName || processedFile.clientName}`]);
        titleRow.font = { 
          size: 16,
          bold: true 
        };
        titleRow.height = 30;
        
        // 헤더 행 추가 및 스타일 설정
        if (processedFile.data.length > 1) {
          const headerRow = sheet.addRow(processedFile.data[1]);
          headerRow.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE6E6E6' }
            };
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
          });
        }
        
        // 데이터 행 추가
        for (let j = 2; j < processedFile.data.length; j++) {
          const rowData = sheet.addRow(processedFile.data[j]);
          
          // 수량 열에 천단위 구분자 적용 (숫자 포맷 사용)
          if (processedFile.data[1]) {
            const headers = processedFile.data[1];
            const quantityIndex = headers.findIndex(header => header === '정상수량');
            if (quantityIndex !== -1 && processedFile.data[j][quantityIndex]) {
              const quantityCell = rowData.getCell(quantityIndex + 1);
              const quantityValue = processedFile.data[j][quantityIndex];
              if (typeof quantityValue === 'number' && !isNaN(quantityValue)) {
                quantityCell.value = Number(quantityValue); // 숫자로 저장
                quantityCell.numFmt = '#,##0'; // 천단위 구분자 포맷 적용
              }
            }
            
            // 유통기한 확인 및 하이라이트
            const expiryIndex = headers.findIndex(header => header === '유통기한');
            if (expiryIndex !== -1 && processedFile.data[j][expiryIndex]) {
              const expiryCell = rowData.getCell(expiryIndex + 1);
              const expiryValue = processedFile.data[j][expiryIndex];
              
              // yyyy-mm-dd 형식에서 연도 추출
              const expiryStr = String(expiryValue);
              const year = parseInt(expiryStr.substring(0, 4));
              
              // 2027년 미만인 경우 노란색 배경 적용
              if (!isNaN(year) && year < 2027) {
                expiryCell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFFFF00' } // 노란색
                };
              }
            }
          }
          
          // 마지막 행인 경우 굵게 표시
          if (j === processedFile.data.length - 1) {
            rowData.eachCell((cell) => {
              cell.font = { bold: true };
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE6E6E6' }
              };
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
          } else {
            rowData.eachCell((cell) => {
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
          }
        }
        
        // 열 너비 조정
        sheet.columns.forEach((column, index) => {
          let maxLength = 0;
          column.eachCell({ includeEmpty: false }, cell => {
            const columnLength = cell.value ? cell.value.toString().length : 10;
            if (columnLength > maxLength) {
              maxLength = columnLength;
            }
          });
          
          // 상품명과 상품코드 열은 더 넓게 설정
          if (processedFile.data[1] && index < processedFile.data[1].length) {
            const headerValue = processedFile.data[1][index];
            if (headerValue === '상품명') {
              // 상품명 열 너비를 65로 고정
              column.width = 65;
            } else if (headerValue === '상품코드') {
              // 상품코드 열에 추가 여백 부여 (최소 15자, 또는 내용 길이 + 3)
              column.width = Math.max(15, maxLength + 3);
            } else {
              // 다른 열은 기존대로 설정
              column.width = maxLength < 10 ? 10 : maxLength + 2;
            }
          } else {
            column.width = maxLength < 10 ? 10 : maxLength + 2;
          }
        });
        }
      }

      // 통합 패킹리스트 시트 추가
      const packingSheet = workbook.addWorksheet('패킹리스트');
      
      // A4 가로 방향 페이지 설정
      packingSheet.pageSetup = {
        paperSize: 9, // A4 용지
        orientation: 'landscape', // 가로 방향
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      };

      // 페이지 번호 푸터 설정 (예: 1/3)
      packingSheet.headerFooter = {
        oddFooter: '&C&P/&N'
      };
      
      // 제목 행 추가
      const packingTitleRow = packingSheet.addRow([packingListData[0][0]]);
      packingTitleRow.font = { 
        size: 16, 
        bold: true 
      };
      packingTitleRow.height = 30;
      
      // 헤더 행 추가 및 스타일 설정
      const packingHeaderRow = packingSheet.addRow(packingListData[1]);
      packingHeaderRow.eachCell((cell) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE6E6E6' }
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      
      // 데이터 행 추가 (마지막 행은 합계 행)
      for (let i = 2; i < packingListData.length; i++) {
        const rowData = packingSheet.addRow(packingListData[i]);
        
        // 마지막 행인 경우 (합계 행) 굵게 표시
        if (i === packingListData.length - 1) {
          rowData.eachCell((cell) => {
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFE6E6E6' }
            };
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        } else {
          rowData.eachCell((cell) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
          });
        }
      }
      
      // 참고사항 추가 (데이터 아래)
      if (note && note.trim() !== '') {
        // 빈 행 추가
        packingSheet.addRow([]);
        
        // 참고사항 제목 추가
        const noteHeaderRow = packingSheet.addRow(['참고사항:']);
        noteHeaderRow.font = {
          size: 14,
          bold: true
        };
        noteHeaderRow.height = 24;
        
        // 참고사항 내용 추가
        const noteContentRow = packingSheet.addRow([note]);
        noteContentRow.font = {
          size: 12,
          bold: true
        };
        noteContentRow.height = 20;
      }
      
      // 열 너비 조정 (패킹리스트)
      packingSheet.columns.forEach((column, index) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: false }, cell => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
      
        // 특정 열의 너비 조정
        if (packingListData[1] && index < packingListData[1].length) {
          // 첫 번째 열(A열 - plt.no)은 5.5로 고정
          if (index === 0) {
            column.width = 5.5;
          }
          // 상품명 열 처리
          else if (packingListData[1][index] === '상품명') {
            column.width = 70;
          }
          // 상품코드 열 처리
          else if (packingListData[1][index] === '상품코드') {
            column.width = Math.max(15, maxLength + 3);
          }
          // 다른 열 처리
          else {
            column.width = maxLength < 10 ? 10 : maxLength + 2;
          }
        } else {
          column.width = maxLength < 10 ? 10 : maxLength + 2;
        }
      });
      
      // 거래명세서 시트 생성
      // 거래명세서를 위한 제품 데이터 수집
      let allProductsForStatement = [];
      
      // 각 파일의 상품 데이터 추출
      processedFiles.forEach(processedFile => {
        if (processedFile.productsForStatement && Array.isArray(processedFile.productsForStatement)) {
          allProductsForStatement = allProductsForStatement.concat(processedFile.productsForStatement);
        }
      });
      
      // 거래명세서 시트 생성 함수 호출
      createTransactionStatementSheet(workbook, allProductsForStatement, datePrefix, clientName);

      // 검수지 시트 생성 (피킹지에서 다중로케이션 제외, 상품코드+유통기한+LOT 동일 시 수량 합산)
      createInspectionSheet(workbook, processedFiles, datePrefix, clientName);

      // 파일 저장 (브라우저에서 다운로드)
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating Excel file:', error);
      throw new Error('엑셀 파일 생성 중 오류가 발생했습니다: ' + error.message);
    }
  };
  
  return (
    <AuthLayout>
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <Head>
        <title>피킹/패킹 생성</title>
        <meta name="description" content="물류 엑셀 파일 처리 앱" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="py-10">
        <div className="max-w-3xl mx-auto">
          <div className="bg-white p-8 rounded-xl shadow-lg">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-indigo-100 rounded-lg">
                <FileUp className="text-indigo-600" size={28} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">
                  물류 엑셀 프로세서 (G)
                </h1>
                <p className="text-sm text-gray-600">
                  피킹지, 패킹리스트, 거래명세서 자동 생성
                </p>
              </div>
            </div>

            <form onSubmit={processExcel} className="space-y-6">
              {/* 날짜 입력 섹션 */}
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="text-blue-600" size={20} />
                  <label className="text-sm font-semibold text-gray-800">
                    날짜 설정
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="px-4 py-2 bg-white border border-gray-300 rounded-md text-lg font-semibold text-blue-600 min-w-[80px] text-center">
                    {datePrefix || '-'}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedDate(getTodayString());
                    }}
                    className="px-3 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 whitespace-nowrap"
                  >
                    오늘
                  </button>
                </div>
              </div>

              {/* 업체명 입력 */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">
                  업체명
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={manualClientName}
                    onChange={(e) => setManualClientName(e.target.value)}
                    placeholder="엑셀 파일에서 자동 추출됩니다"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {extractedClientName && !manualClientName && (
                    <button
                      type="button"
                      onClick={() => setManualClientName(extractedClientName)}
                      className="px-3 py-2 bg-gray-100 text-gray-700 text-sm rounded-md hover:bg-gray-200 whitespace-nowrap border border-gray-300"
                    >
                      "{extractedClientName}" 사용
                    </button>
                  )}
                </div>
                {extractedClientName && (
                  <p className="mt-1 text-xs text-green-600">
                    ✓ 추출된 업체명: <strong>{extractedClientName}</strong>
                    {manualClientName && manualClientName !== extractedClientName && (
                      <span className="text-blue-600 ml-2">→ 수정됨: <strong>{manualClientName}</strong></span>
                    )}
                  </p>
                )}
                {!extractedClientName && (
                  <p className="mt-1 text-xs text-gray-500">
                    파일 업로드 후 자동 추출되거나, 직접 입력할 수 있습니다
                  </p>
                )}
              </div>

              {/* 파일 업로드 */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">
                  엑셀 파일 업로드
                </label>
                <input
                  type="file"
                  onChange={handleFilesChange}
                  accept=".xls,.xlsx,.csv"
                  multiple
                  className="w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-blue-400 transition-colors"
                />
                {files.length > 0 && (
                  <p className="mt-2 text-sm text-green-600">
                    ✓ {files.length}개 파일 선택됨
                  </p>
                )}
              </div>

              {/* 옵션 설정 */}
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <Settings className="text-gray-600" size={20} />
                  <label className="text-sm font-semibold text-gray-800">
                    처리 옵션
                  </label>
                </div>

                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={combineSheets}
                      onChange={(e) => setCombineSheets(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        하나의 시트에 통합
                      </span>
                      <p className="text-xs text-gray-600">
                        여러 전표를 별도 시트가 아닌 하나의 시트에 행으로 구분하여 표시
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sortByLocation}
                      onChange={(e) => setSortByLocation(e.target.checked)}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        로케이션 정렬
                      </span>
                      <p className="text-xs text-gray-600">
                        각 전표의 데이터를 로케이션 기준으로 오름차순 정렬
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={smartSort}
                      onChange={(e) => setSmartSort(e.target.checked)}
                      className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                    />
                    <div>
                      <span className="text-sm font-medium text-gray-800">
                        스마트 정렬
                      </span>
                      <p className="text-xs text-gray-600">
                        상품명 키워드(500ml, 마스크 등)로 그룹화 + 같은 상품코드 연속 배치
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* 참고사항 */}
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-2">
                  참고사항 (선택)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="패킹리스트에 표시될 참고사항을 입력하세요"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
              </div>

              {/* 에러/성공 메시지 */}
              {error && (
                <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
                  <strong>오류:</strong> {error}
                </div>
              )}

              {success && (
                <div className="p-4 bg-green-50 border border-green-200 text-green-700 rounded-lg">
                  ✓ 파일이 성공적으로 처리되었습니다!
                </div>
              )}

              {/* 제출 버튼 */}
              <button
                type="submit"
                disabled={processing || !files.length || !datePrefix}
                className={`w-full py-3 px-4 rounded-lg text-white font-semibold text-lg transition-all ${
                  processing || !files.length || !datePrefix
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-md hover:shadow-lg'
                }`}
              >
                {processing ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    처리 중...
                  </span>
                ) : (
                  '파일 처리 및 다운로드'
                )}
              </button>
            </form>
          </div>

          {/* 사용 가이드 */}
          <div className="mt-6 bg-white p-6 rounded-xl shadow-lg">
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              📖 사용 가이드
            </h2>
            <div className="space-y-3 text-sm text-gray-700">
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">1</span>
                <p><strong>날짜 설정:</strong> 캘린더에서 선택하거나 직접 입력 (예: 3/31)</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">2</span>
                <p><strong>파일 업로드:</strong> 처리할 엑셀 파일을 한 개 이상 선택</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">3</span>
                <p><strong>옵션 선택:</strong> 필요에 따라 시트 통합, 로케이션 정렬 옵션 설정</p>
              </div>
              <div className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold">4</span>
                <p><strong>다운로드:</strong> 처리 버튼 클릭하면 피킹지, 패킹리스트, 거래명세서가 포함된 엑셀 파일 자동 다운로드</p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-sm text-yellow-800">
                <strong>💡 팁:</strong> 여러 전표를 하나의 시트에 보고 싶다면 "하나의 시트에 통합" 옵션을 활성화하세요. 각 전표가 행으로 구분되어 표시됩니다.
              </p>
            </div>

            {/* 데이터 처리 안내 */}
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="text-sm font-bold text-blue-900 mb-2">📊 데이터 처리 방식</h3>
              <ul className="text-xs text-blue-800 space-y-1">
                <li>• <strong>피킹지:</strong> 업로드한 원본 데이터를 그대로 표시</li>
                <li>• <strong>패킹리스트:</strong> 모든 상품을 합치되, 중복 제거 없이 나열</li>
                <li>• <strong>거래명세서:</strong> 같은 상품코드+상품명의 수량을 자동 합산</li>
              </ul>
            </div>

            {/* 주의사항 */}
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <h3 className="text-sm font-bold text-red-900 mb-2">⚠️ 주의사항</h3>
              <ul className="text-xs text-red-800 space-y-1">
                <li>• 여러 파일을 업로드하면 <strong>모든 파일의 데이터가 통합</strong>됩니다</li>
                <li>• 거래명세서에서는 <strong>동일 상품의 수량이 자동 합산</strong>되므로 확인이 필요합니다</li>
                <li>• 같은 상품을 여러 전표에서 중복 업로드하면 거래명세서에 합산되어 표시됩니다</li>
                <li>• 정상수량이 0인 행은 자동으로 제외됩니다</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
    </AuthLayout>
  );
}