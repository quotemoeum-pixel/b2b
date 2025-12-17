// pages/b2b/index.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import supabase from '@/lib/supabase';
import AuthLayout from '@/components/AuthLayout';
import { useAuth } from '../_app';

export default function B2BDelivery() {
  const [datePrefix, setDatePrefix] = useState('');
  const [clientName, setClientName] = useState('');
  const [note, setNote] = useState(''); // 참고사항 추가
  const [isDutyFree, setIsDutyFree] = useState(false); // 면세점 체크박스
  const [files, setFiles] = useState([]); // 다중 파일 배열로 변경
  const [productMergeMode, setProductMergeMode] = useState(false); // 상품별 통합 모드

  // 날짜를 m/d 형식으로 변환하는 함수
  const formatDate = (date) => {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // 영업일 기준 다음날 계산 (토,일 제외)
  const getNextBusinessDay = () => {
    const today = new Date();
    let nextDay = new Date(today);
    nextDay.setDate(nextDay.getDate() + 1);

    // 토요일(6)이면 월요일로
    if (nextDay.getDay() === 6) {
      nextDay.setDate(nextDay.getDate() + 2);
    }
    // 일요일(0)이면 월요일로
    else if (nextDay.getDay() === 0) {
      nextDay.setDate(nextDay.getDate() + 1);
    }

    return nextDay;
  };

  // 오늘 날짜 설정
  const setToday = () => {
    const today = new Date();
    setDatePrefix(formatDate(today));
  };

  // 영업일 기준 내일 날짜 설정
  const setNextBusinessDay = () => {
    const nextDay = getNextBusinessDay();
    setDatePrefix(formatDate(nextDay));
  };

  // 면세점 체크박스 처리
  const handleDutyFreeChange = (checked) => {
    setIsDutyFree(checked);

    const dutyFreeText = `27년 7월재고부터 출고가능
입고서 동봉후 표시
취급주의라벨 부착
무지박스 H테이핑`;

    if (checked) {
      // 체크 시: 기존 참고사항이 있으면 줄바꿈 후 추가, 없으면 그냥 추가
      if (note.trim()) {
        setNote(note + '\n\n' + dutyFreeText);
      } else {
        setNote(dutyFreeText);
      }
    } else {
      // 체크 해제 시: 면세점 텍스트 제거
      const newNote = note.replace(dutyFreeText, '').trim();
      setNote(newNote);
    }
  };

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // 다중 파일 처리를 위한 배열
  const [processedFiles, setProcessedFiles] = useState([]);
  
  const router = useRouter();
  const { isLoggedIn, loading } = useAuth();

  // 유통기한 하이라이트 체크 함수
  // 반환값: 'yellow' (2026년 이하), 'orange' (2027년 1월~6월), null (하이라이트 없음)
  const checkExpiryDateHighlight = (expiryDate) => {
    if (!expiryDate) return null;

    let year, month;

    // Excel 날짜 형식 처리 (숫자인 경우)
    if (typeof expiryDate === 'number') {
      // Excel 날짜는 1900-01-01부터의 일수
      // JavaScript Date는 1970-01-01부터의 밀리초
      const excelEpoch = new Date(1900, 0, 1);
      const msPerDay = 24 * 60 * 60 * 1000;

      // Excel은 1900년을 윤년으로 잘못 계산하므로 2일을 빼야 함
      const date = new Date(excelEpoch.getTime() + (expiryDate - 2) * msPerDay);
      year = date.getFullYear();
      month = date.getMonth() + 1; // 0-indexed이므로 +1
    } else {
      // 문자열 형식 처리
      const dateStr = expiryDate.toString().trim();

      // xxxx-xx-xx 형식의 날짜에서 연도와 월 추출
      const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-\d{2}$/);
      if (dateMatch) {
        year = parseInt(dateMatch[1], 10);
        month = parseInt(dateMatch[2], 10);
      } else {
        return null;
      }
    }

    // 2026년 이하: 노란색
    if (year < 2027) {
      return 'yellow';
    }

    // 2027년 1월~6월: 주황색
    if (year === 2027 && month <= 6) {
      return 'orange';
    }

    return null;
  };

  const handleFilesChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(selectedFiles);
    setError('');
    setSuccess(false);
    setProcessedFiles([]);
  };

  const processFiles = async (e) => {
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
      // 상품별 통합 모드인 경우
      if (productMergeMode) {
        await processFilesProductMergeMode();
      } else {
        // 기존 모드
        await processFilesNormalMode();
      }

      setSuccess(true);
    } catch (err) {
      console.error('Error processing files:', err);
      setError('파일 처리 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 기존 파일별 처리 모드
  const processFilesNormalMode = async () => {
    // 파일 처리 결과를 담을 배열
    const processedFilesData = [];

    for (const file of files) {
      // 파일 읽기
      const data = await readExcelFile(file);
      console.log(`파일 데이터 (${file.name}):`, data);

      // 데이터 처리 및 거래처명 추출
      const result = processData(data);
      console.log('처리된 데이터:', result.processedData);
      console.log('거래처명:', result.clientName);

      // 거래처명에서 "주식회사" 제거
      const cleanedClientName = removeCompanyPrefix(result.clientName);
      console.log('정리된 거래처명:', cleanedClientName);

      // Supabase에서 박스 수 계산
      let boxCalculation = {
        totalQuantity: 0,
        totalBoxes: 0,
        calculationDetails: []
      };

      if (result.productCodes && result.productCodes.length > 0) {
        boxCalculation = await calculateBoxes(
          result.productCodes,
          result.productNames || [],
          result.normalQuantities || []
        );
      }

      // 박스 타입 열을 processedData에 추가
      const processedDataWithBoxType = addBoxTypeColumn(result.processedData, boxCalculation);

      // 처리된 파일 정보 추가
      processedFilesData.push({
        fileName: file.name,
        originalData: data,
        processedData: processedDataWithBoxType,
        originalClientName: result.clientName,
        clientName: cleanedClientName,
        boxCalculation,
        boxCount: boxCalculation.totalBoxes.toString()
      });
    }

    // 거래처명이 있는 파일에서 첫 번째 거래처명 찾기
    const firstValidClientName = processedFilesData.find(f => f.clientName && f.clientName.trim() !== '')?.clientName || '';

    // 거래처명이 없는 파일에 다른 파일의 거래처명 적용
    if (firstValidClientName) {
      processedFilesData.forEach(file => {
        if (!file.clientName || file.clientName.trim() === '') {
          file.clientName = firstValidClientName;
          file.originalClientName = file.originalClientName || firstValidClientName;
        }
      });
    }

    // 모든 파일 처리 완료 후 상태 업데이트
    setProcessedFiles(processedFilesData);

    // 첫 번째 유효한 거래처명으로 전체 거래처명 설정 (이후 수정 가능)
    if (firstValidClientName) {
      setClientName(firstValidClientName);
    }
  };

  // 상품별 통합 모드 처리
  const processFilesProductMergeMode = async () => {
    // 모든 파일에서 데이터 수집
    const allItems = []; // {productCode, productName, location, quantity, expiryDate, lot, clientName}
    let firstClientName = '';

    for (const file of files) {
      const data = await readExcelFile(file);
      const result = processData(data);

      if (!firstClientName && result.clientName) {
        firstClientName = removeCompanyPrefix(result.clientName);
      }

      // processedData에서 개별 항목 추출 (헤더: 상품코드, 상품명, 유통기한, LOT, 다중로케이션, 정상수량)
      const headers = result.processedData[1] || [];
      const productCodeIdx = headers.findIndex(h => h === '상품코드');
      const productNameIdx = headers.findIndex(h => h === '상품명');
      const expiryDateIdx = headers.findIndex(h => h === '유통기한');
      const lotIdx = headers.findIndex(h => h === 'LOT');
      const locationIdx = headers.findIndex(h => h === '다중로케이션');
      const quantityIdx = headers.findIndex(h => h === '정상수량');

      for (let i = 2; i < result.processedData.length; i++) {
        const row = result.processedData[i];
        if (!row || row.length === 0) continue;

        const productCode = productCodeIdx !== -1 ? (row[productCodeIdx] || '').toString().trim() : '';
        const productName = productNameIdx !== -1 ? (row[productNameIdx] || '').toString().trim() : '';
        const location = locationIdx !== -1 ? (row[locationIdx] || '').toString().trim() : '';
        const quantity = quantityIdx !== -1 ? (parseFloat(String(row[quantityIdx]).replace(/,/g, '')) || 0) : 0;
        const expiryDate = expiryDateIdx !== -1 ? (row[expiryDateIdx] || '') : '';
        const lot = lotIdx !== -1 ? (row[lotIdx] || '') : '';

        if (productCode && quantity > 0) {
          allItems.push({
            productCode,
            productName,
            location,
            quantity,
            expiryDate,
            lot,
            fileName: file.name
          });
        }
      }
    }

    // 상품코드+로케이션 기준으로 그룹화
    const productLocationMap = new Map();

    allItems.forEach(item => {
      const key = `${item.productCode}|||${item.location}`;

      if (!productLocationMap.has(key)) {
        productLocationMap.set(key, {
          productCode: item.productCode,
          productName: item.productName,
          location: item.location,
          items: []
        });
      }

      productLocationMap.get(key).items.push({
        quantity: item.quantity,
        expiryDate: item.expiryDate,
        lot: item.lot,
        fileName: item.fileName
      });
    });

    // 그룹별로 시트 데이터 생성
    const processedFilesData = [];
    const sortedGroups = Array.from(productLocationMap.values())
      .sort((a, b) => a.productCode.localeCompare(b.productCode, 'ko'));

    // 모든 상품코드 수집 (박스 계산용)
    const allProductCodes = sortedGroups.map(g => g.productCode);
    const allProductNames = sortedGroups.map(g => g.productName);
    const allQuantities = sortedGroups.map(g =>
      g.items.reduce((sum, item) => sum + item.quantity, 0)
    );

    // 박스 계산
    const boxCalculation = await calculateBoxes(allProductCodes, allProductNames, allQuantities);

    for (const group of sortedGroups) {
      const totalQuantity = group.items.reduce((sum, item) => sum + item.quantity, 0);

      // 시트 데이터 생성
      const sheetData = [];

      // 제목 행
      sheetData.push([`${datePrefix} ${firstClientName} 택배 - ${group.productCode}`]);

      // 헤더 행
      sheetData.push(['상품코드', '상품명', '유통기한', 'LOT', '다중로케이션', '정상수량', '파일']);

      // 데이터 행 (각 파일별 수량)
      group.items.forEach(item => {
        sheetData.push([
          group.productCode,
          group.productName,
          item.expiryDate || '',
          item.lot || '',
          group.location,
          item.quantity,
          item.fileName
        ]);
      });

      // 합계 행
      sheetData.push(['합계', '', '', '', '', totalQuantity, '']);

      // 박스 계산 상세 찾기
      const detail = boxCalculation.calculationDetails.find(d => d.productCode === group.productCode);

      processedFilesData.push({
        fileName: `${group.productCode} (${group.location || '위치없음'})`,
        originalData: [],
        processedData: sheetData,
        originalClientName: firstClientName,
        clientName: firstClientName,
        boxCalculation: {
          totalQuantity: totalQuantity,
          totalBoxes: detail ? detail.boxCount : 0,
          calculationDetails: detail ? [detail] : []
        },
        boxCount: detail ? detail.boxCount.toString() : '0',
        isProductMergeMode: true
      });
    }

    setProcessedFiles(processedFilesData);
    setClientName(firstClientName);
  };

  // 무게에 따른 박스 타입 결정 함수
  const getBoxType = (weight) => {
    if (!weight || weight === 0) return '-';
    if (weight >= 25) return '취급제한';
    if (weight >= 20) return '이형';
    if (weight >= 15) return '대2';
    if (weight >= 10) return '대1';
    if (weight >= 5) return '중';
    return '-';
  };

  // 박스 타입 우선순위 반환 (큰 것부터)
  const getBoxTypePriority = (boxType) => {
    const priorities = {
      '취급제한': 1,
      '이형': 2,
      '대2': 3,
      '대1': 4,
      '중': 5,
      '-': 6
    };
    return priorities[boxType] || 999;
  };

  // 박스 타입 열을 processedData에 추가하는 함수
  const addBoxTypeColumn = (processedData, boxCalculation) => {
    if (!processedData || processedData.length < 2) return processedData;
    if (!boxCalculation || !boxCalculation.calculationDetails) return processedData;

    const newData = [];

    // 첫 번째 행 (제목)
    newData.push(processedData[0]);

    // 두 번째 행 (헤더) - 박스타입 열 추가
    const headers = [...processedData[1]];
    const quantityIndex = headers.findIndex(h => h === '정상수량');
    const locationIndex = headers.findIndex(h => h === '다중로케이션');
    if (quantityIndex !== -1) {
      headers.splice(quantityIndex + 1, 0, '박스타입');
    }
    newData.push(headers);

    // 데이터 행들 수집 (3번째 행부터)
    const dataRows = [];
    for (let i = 2; i < processedData.length; i++) {
      const row = [...processedData[i]];

      // 상품코드로 boxCalculation에서 해당 정보 찾기
      const productCode = row[0]; // 상품코드는 첫 번째 열
      const detail = boxCalculation.calculationDetails.find(d => d.productCode === productCode);

      // 로케이션 값 가져오기 (박스타입 열 추가 전 인덱스 사용)
      const location = locationIndex !== -1 ? row[locationIndex] : '';

      // 박스타입 열 추가
      if (quantityIndex !== -1) {
        const boxType = detail ? detail.boxType : '-';
        const boxCount = detail ? detail.boxCount : 0;
        // 박스수가 정수일 때만 박스타입 표시
        const isWholeNumber = Number.isInteger(boxCount);
        const boxTypeText = boxType !== '-' && boxCount > 0 && isWholeNumber ? `${boxType} ${boxCount}box` : '-';
        row.splice(quantityIndex + 1, 0, boxTypeText);
      }

      // 정렬을 위해 박스타입 정보와 로케이션 함께 저장
      dataRows.push({
        row: row,
        boxType: detail ? detail.boxType : '-',
        actualWeight: detail ? detail.actualWeight : 0,
        location: location || ''
      });
    }

    // 다중로케이션 오름차순으로 정렬
    dataRows.sort((a, b) => compareLocations(a.location, b.location));

    // 정렬된 데이터 행 추가
    dataRows.forEach(item => {
      newData.push(item.row);
    });

    return newData;
  };

  // Supabase에서 박스 수 계산
  const calculateBoxes = async (productCodes, productNames, quantities) => {
    try {
      // 중복 제거한 상품코드 목록
      const uniqueProductCodes = [...new Set(productCodes)];
      
      console.log('조회할 상품코드 목록:', uniqueProductCodes);
      
      // Supabase에서 상품 정보 가져오기
      const { data, error } = await supabase
        .from('products')
        .select('product_code, ea_per_box, weight_per_box, weight_per_ea')
        .in('product_code', uniqueProductCodes);
      
      if (error) {
        console.error('Supabase error:', error);
        return {
          totalQuantity: 0,
          totalBoxes: 0,
          calculationDetails: []
        };
      }
      
      console.log('데이터베이스 응답:', data);

      // 상품코드별 ea_per_box, weight_per_box, weight_per_ea 매핑 생성
      const productInfoMap = {};
      data.forEach(product => {
        productInfoMap[product.product_code] = {
          eaPerBox: product.ea_per_box || 0,
          weightPerBox: product.weight_per_box || 0,
          weightPerEa: product.weight_per_ea || 0
        };
      });

      console.log('상품코드별 정보 매핑:', productInfoMap);
      
      // 박스 수 계산
      let totalQuantity = 0;
      let totalBoxes = 0;
      const calculationDetails = [];
      
      for (let i = 0; i < productCodes.length; i++) {
        const productCode = productCodes[i];
        const productName = productNames[i] || '';
        const quantity = quantities[i] || 0;
        const productInfo = productInfoMap[productCode] || { eaPerBox: 0, weightPerBox: 0, weightPerEa: 0 };
        const eaPerBox = productInfo.eaPerBox;
        const weightPerBox = productInfo.weightPerBox;
        const weightPerEa = productInfo.weightPerEa;

        console.log(`상품 ${productCode} (${productName}): 수량=${quantity}, EA/BOX=${eaPerBox}, WEIGHT/BOX=${weightPerBox}, WEIGHT/EA=${weightPerEa}`);

        totalQuantity += quantity;

        let boxCount = 0;
        if (eaPerBox && eaPerBox > 0) {
          boxCount = +(quantity / eaPerBox).toFixed(2);
          totalBoxes += boxCount;
        }

        // 실제 배송 무게 계산 (개당 무게가 있으면 사용, 없으면 박스 무게 사용)
        let actualWeight = 0;
        if (weightPerEa > 0) {
          // 개당 무게로 실제 배송 무게 계산
          actualWeight = quantity * weightPerEa;
        } else if (weightPerBox > 0 && boxCount > 0) {
          // 개당 무게 없으면 박스 무게 사용
          actualWeight = weightPerBox;
        }

        // 박스 타입 결정 (실제 배송 무게 기준)
        const boxType = getBoxType(actualWeight);

        console.log(`계산된 박스 수: ${boxCount}, 실제 무게: ${actualWeight}kg, 박스 타입: ${boxType}`);

        calculationDetails.push({
          productCode,
          productName,
          quantity,
          eaPerBox,
          boxCount,
          boxType,
          actualWeight
        });
      }
      
      console.log('총 수량:', totalQuantity, '총 박스 수:', totalBoxes);
      
      return {
        totalQuantity,
        totalBoxes,
        calculationDetails
      };
    } catch (err) {
      console.error('Error calculating boxes:', err);
      return {
        totalQuantity: 0,
        totalBoxes: 0,
        calculationDetails: []
      };
    }
  };
  
  const exportExcel = async () => {
    if (!processedFiles.length) {
      setError('먼저 파일을 처리해주세요.');
      return;
    }

    setProcessing(true);
    try {
      // 날짜 형식 변환 (m/d -> mmdd)
      let formattedDate = formatDateForFileName(datePrefix);

      // 상품별 통합 모드 여부 확인
      const isProductMerge = processedFiles.some(f => f.isProductMergeMode);

      // 파일명 생성
      let fileName;
      if (isProductMerge) {
        fileName = `${formattedDate}${clientName || ''}_B2B택배_상품별통합.xlsx`;
      } else {
        fileName = `${formattedDate}${clientName || ''}_B2B택배.xlsx`;
      }

      // 파일명이 생성되지 않았거나 거래처명이 없는 경우 기본 파일명 사용
      if (!clientName || clientName.trim() === '') {
        fileName = isProductMerge
          ? `${formattedDate}_처리된_물류데이터택배_상품별통합.xlsx`
          : `${formattedDate}_처리된_물류데이터택배.xlsx`;
      }

      // 다운로드 (ExcelJS 사용) - 여러 시트를 포함한 하나의 엑셀 파일
      await downloadMultiSheetExcel(processedFiles, fileName, datePrefix, clientName, note);
      setSuccess(true);
    } catch (err) {
      console.error('Error exporting file:', err);
      setError('파일 내보내기 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 거래처명에서 "주식회사" 제거하는 함수
  const removeCompanyPrefix = (name) => {
    if (!name) return '';
    
    // "주식회사" 제거 (앞이나 뒤에 있는 경우 모두 처리)
    let cleanedName = name.replace(/^주식회사\s+/, ''); // 맨 앞의 "주식회사 " 제거
    cleanedName = cleanedName.replace(/\s+주식회사$/, ''); // 맨 뒤의 " 주식회사" 제거
    
    return cleanedName.trim();
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
            cellDates: true,
            dateNF: 'yyyy-mm-dd' // 날짜 형식 지정
          });
          
          // 첫 번째 시트 사용
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // 시트의 데이터를 배열로 변환
          const sheetData = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1,
            defval: '',
            blankrows: true,
            raw: false, // 날짜를 문자열로 변환
            dateNF: 'yyyy-mm-dd' // 날짜 형식 지정
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

  // 로케이션 정렬 함수 추가
  const compareLocations = (locA, locB) => {
    // 유효한 로케이션 값인지 확인
    if (!locA && !locB) return 0;
    if (!locA) return 1;  // 로케이션 없는 항목은 뒤로
    if (!locB) return -1; // 로케이션 있는 항목은 앞으로

    // 로케이션 문자열 정리 (공백 제거, 대문자화)
    const cleanLocA = locA.toString().trim().toUpperCase();
    const cleanLocB = locB.toString().trim().toUpperCase();
    
    // AA-10-16-04 형식의 로케이션 파싱
    const partsA = cleanLocA.split('-');
    const partsB = cleanLocB.split('-');
    
    // 구역(알파벳) 비교
    if (partsA[0] !== partsB[0]) {
      return partsA[0].localeCompare(partsB[0]);
    }
    
    // 숫자 부분 비교 (첫 번째 숫자)
    if (partsA.length > 1 && partsB.length > 1) {
      const numA = parseInt(partsA[1], 10);
      const numB = parseInt(partsB[1], 10);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        return numA - numB;
      }
    }
    
    // 두 번째 숫자 비교
    if (partsA.length > 2 && partsB.length > 2) {
      const numA = parseInt(partsA[2], 10);
      const numB = parseInt(partsB[2], 10);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        return numA - numB;
      }
    }
    
    // 세 번째 숫자 비교
    if (partsA.length > 3 && partsB.length > 3) {
      const numA = parseInt(partsA[3], 10);
      const numB = parseInt(partsB[3], 10);
      if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        return numA - numB;
      }
    }
    
    // 같은 경우 또는 형식이 다른 경우 원래 문자열 비교
    return cleanLocA.localeCompare(cleanLocB);
  };
  
  const processData = (data) => {
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
        '상품코드', '상품명', '유통기한', 'lot', '정상수량', '정상다중로케이션'
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
            console.log(`컬럼 매핑: "${foundColumn}" -> index ${i} (원본: "${cellValue}")`);
          }
        }
      }

      console.log('최종 헤더 매핑:', headerIndexMap);

      // 거래처 열의 인덱스 찾기
      const normalQuantityIndex = headerIndexMap['정상수량'];
      const productCodeIndex = headerIndexMap['상품코드'];
      
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

      // 상품코드와 정상수량 추출 (박스 수 계산용)
      const productCodes = [];
      const productNames = [];
      const normalQuantities = [];
      
      if (productCodeIndex !== undefined && normalQuantityIndex !== undefined) {
        const productNameIndex = headerIndexMap['상품명'];

        console.log(`정상수량 컬럼 인덱스: ${normalQuantityIndex}`);

        for (let i = headerRow + 1; i < data.length; i++) {
          const row = data[i];
          if (!row || !Array.isArray(row)) continue;

          const productCode = row[productCodeIndex];
          const quantity = row[normalQuantityIndex];
          const productName = productNameIndex !== undefined ? row[productNameIndex] : '';

          console.log(`행 ${i}: 상품코드=${productCode}, 정상수량(index ${normalQuantityIndex})=${quantity}, 전체 행 길이=${row.length}`);

          // 정상수량이 0인 행은 건너뛰기
          if (quantity === 0 || quantity === '0') continue;

          if (productCode && quantity) {
            productCodes.push(productCode.toString().trim());
            productNames.push(productName ? productName.toString().trim() : '');
            // 쉼표 제거 후 숫자로 변환
            const cleanedQuantity = quantity.toString().replace(/,/g, '');
            normalQuantities.push(parseFloat(cleanedQuantity) || 0);
            console.log(`추가됨: 상품코드=${productCode}, 수량=${quantity} -> ${cleanedQuantity}`);
          }
        }

        console.log(`총 추출된 상품 수: ${productCodes.length}, 수량 배열:`, normalQuantities);
      }

      // 피킹지 데이터 생성 (로케이션 정렬 적용)
      const sheetData = createSheetData(data, headerRow, headerIndexMap, datePrefix, clientName, normalQuantityIndex);
      
      return { 
        processedData: sheetData,
        clientName,
        productCodes,
        productNames,
        normalQuantities
      };
    } catch (error) {
      console.error('Error in processData:', error);
      throw error; // 오류를 호출자에게 전파
    }
  };

  // 시트 데이터 생성 함수 수정 (로케이션 순 정렬 적용)
  const createSheetData = (data, headerRow, headerIndexMap, datePrefix, clientName, normalQuantityIndex) => {
    try {
      // 데이터 유효성 검사
      if (!data || !Array.isArray(data) || !headerIndexMap) {
        console.error('Invalid data or headerIndexMap in createSheetData', { data, headerIndexMap });
        return [[]]; // 오류 시 빈 배열 반환
      }
      
      // 새로운 헤더 행 만들기 (거래처와 바코드 제외)
      const newHeaders = ['상품코드', '상품명', '유통기한', 'LOT', '다중로케이션', '정상수량']
        .filter(col => {
          // 대문자 LOT은 소문자 lot으로 headerIndexMap에서 찾아야 함
          if (col === 'LOT') return headerIndexMap['lot'] !== undefined;
          // 다중로케이션은 정상다중로케이션으로 headerIndexMap에서 찾아야 함
          if (col === '다중로케이션') return headerIndexMap['정상다중로케이션'] !== undefined;
          return headerIndexMap[col] !== undefined;
        });
      
      // 새 데이터 만들기
      const newData = [];
      
      // 거래처명에서 "주식회사" 제거
      const cleanedClientName = removeCompanyPrefix(clientName);
      
      // 첫 번째 행 추가 (거래처 정보)
      if (datePrefix && cleanedClientName) {
        newData.push([`${datePrefix} ${cleanedClientName} 택배`]);
      } else {
        newData.push(['']); // 날짜나 거래처명이 없는 경우 빈 행 추가
      }
    
      // 헤더 행 추가
      newData.push(newHeaders);
      
      // 데이터 행 수집 (헤더 다음 행부터)
      const rows = [];
      const locationColumnIndex = headerIndexMap['정상다중로케이션'];
      
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
          // 대문자 LOT은 소문자 lot으로, 다중로케이션은 정상다중로케이션으로 headerIndexMap에서 찾아야 함
          let colName = col;
          if (col === 'LOT') colName = 'lot';
          if (col === '다중로케이션') colName = '정상다중로케이션';
          const colIndex = headerIndexMap[colName];
          let value = (colIndex !== undefined && row[colIndex] !== undefined) ? row[colIndex] || '' : '';

          // 정상수량은 숫자로 변환 (엑셀에서 합계 계산 가능하도록)
          if (col === '정상수량' && value !== '') {
            const numValue = parseFloat(String(value).replace(/,/g, ''));
            return isNaN(numValue) ? value : numValue;
          }
          return value;
        });
        
        // 최소한 하나의 셀에 데이터가 있으면 행 추가
        if (newRow.some(cell => cell)) {
          // 로케이션 값 보존 (정렬용)
          const location = locationColumnIndex !== undefined ? row[locationColumnIndex] : '';
          rows.push({
            data: newRow,
            location: location || ''
          });
        }
      }
      
      // 로케이션 기준으로 정렬
      rows.sort((a, b) => compareLocations(a.location, b.location));
      
      // 정렬된 행 데이터 추가
      for (const row of rows) {
        newData.push(row.data);
      }
      
      return newData;
    } catch (error) {
      console.error('Error in createSheetData:', error);
      return [['오류가 발생했습니다']]; // 오류 발생 시 최소한의 데이터 반환
    }
  };

  // 여러 시트가 있는 엑셀 파일 다운로드 함수 (유통기한 하이라이트 포함)
  const downloadMultiSheetExcel = async (processedFiles, fileName, datePrefix, clientName, note) => {
    try {
      if (!processedFiles || !Array.isArray(processedFiles) || processedFiles.length === 0) {
        console.error('Invalid processed files structure for Excel file', processedFiles);
        throw new Error('엑셀 파일을 생성할 수 없습니다: 처리된 파일이 없습니다.');
      }
      
      // ExcelJS 워크북 생성
      const workbook = new ExcelJS.Workbook();
      workbook.creator = '물류 엑셀 프로세서';
      workbook.created = new Date();
      
      // 문서 보안 관련 속성 설정
      workbook.company = '회사명';
      workbook.manager = '관리자';
      workbook.subject = '물류 데이터';
      workbook.category = '업무용';
      workbook.keywords = '물류,택배,피킹';
      
      // 각 파일별로 별도의 시트 생성
      for (let i = 0; i < processedFiles.length; i++) {
        const processedFile = processedFiles[i];
        // 상품별 통합 모드일 때는 상품코드를 시트명으로 사용
        let sheetName;
        if (processedFile.isProductMergeMode) {
          // 시트명에 사용할 수 없는 문자 제거 및 31자 제한
          sheetName = processedFile.fileName
            .replace(/[\\/*?:\[\]]/g, '')
            .substring(0, 31);
        } else {
          sheetName = `피킹지 ${i + 1}`;
        }
        const sheet = workbook.addWorksheet(sheetName);
        
        // A4 가로 방향 페이지 설정 추가
        sheet.pageSetup = {
          paperSize: 9, // A4 용지 (9는 A4를 의미함)
          orientation: 'landscape', // 가로 방향
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,    
        };
        
        // 각 파일별 제목 행 생성 (박스수 포함)
        let titleText = '';
        if (datePrefix && clientName) {
          const boxCountText = processedFile.boxCount && processedFile.boxCount.trim() !== '' 
            ? ` ${processedFile.boxCount}BOX` 
            : '';
          titleText = `${datePrefix} ${clientName} 택배${boxCountText}`;
        }
        
        // 헤더 행 추가 및 스타일 설정
        const data = processedFile.processedData;
        if (data.length > 1) {
          // 첫 행 추가 및 스타일 지정 (큰 폰트 크기)
          const titleRow = sheet.addRow([titleText]);
          titleRow.font = {
            size: 24,  // 폰트 크기 증가
            bold: true // 굵게 표시
          };
          titleRow.height = 40; // 행 높이도 증가

          // 제목 행을 모든 헤더 열에 걸쳐 병합
          const headerColumnCount = data[1].length;
          if (headerColumnCount > 1) {
            sheet.mergeCells(1, 1, 1, headerColumnCount);
          }

          const headerRow = sheet.addRow(data[1]);
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
        
        // 데이터 행 추가 (유통기한 하이라이트 포함)
        for (let j = 2; j < data.length; j++) {
          const rowData = sheet.addRow(data[j]);
          
          // 유통기한 열 인덱스 찾기 (헤더에서 '유통기한' 열의 위치)
          const expiryDateColumnIndex = data[1] ? data[1].findIndex(header => 
            header && header.toString().includes('유통기한')
          ) : -1;
          
          // 유통기한 하이라이트 확인 ('yellow', 'orange', null)
          let highlightType = null;
          if (expiryDateColumnIndex !== -1 && data[j] && data[j][expiryDateColumnIndex]) {
            highlightType = checkExpiryDateHighlight(data[j][expiryDateColumnIndex]);
          }

          // 마지막 행인 경우 굵게 표시
          if (j === data.length - 1) {
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
              // 유통기한 하이라이트 적용
              if (highlightType === 'yellow') {
                // 2026년 이하: 노란색 배경
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFFFF00' }
                };
              } else if (highlightType === 'orange') {
                // 2027년 1월~6월: 주황색 배경
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: 'FFFFC000' }
                };
              }

              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
              };
            });
          }
        }

        // 빈 행 추가 (테이블과 하단 정보 구분)
        const separatorRowIndex = sheet.addRow([]).number;

        // 박스타입별 총계 추가 (C열에 표시)
        if (processedFile.boxCalculation && processedFile.boxCalculation.calculationDetails) {
          // 박스타입별로 그룹화하여 총 박스 수 계산
          const boxTypeSummary = {};

          processedFile.boxCalculation.calculationDetails.forEach(detail => {
            const boxType = detail.boxType;
            const boxCount = detail.boxCount;

            // 박스수가 정수일 때만 박스타입 총계에 포함
            if (boxType !== '-' && boxCount > 0 && Number.isInteger(boxCount)) {
              if (!boxTypeSummary[boxType]) {
                boxTypeSummary[boxType] = {
                  type: boxType,
                  totalBoxes: 0,
                  priority: getBoxTypePriority(boxType)
                };
              }
              boxTypeSummary[boxType].totalBoxes += boxCount;
            }
          });

          // 박스타입 우선순위로 정렬 (큰 것부터)
          const sortedBoxTypes = Object.values(boxTypeSummary)
            .sort((a, b) => a.priority - b.priority);

          // 박스타입 요약이 있으면 C열에 추가 (분리된 행 바로 다음부터)
          if (sortedBoxTypes.length > 0) {
            let currentRow = separatorRowIndex + 1;
            sortedBoxTypes.forEach(item => {
              const cell = sheet.getRow(currentRow).getCell(3);
              cell.value = `${item.type} ${item.totalBoxes}box`;
              cell.font = {
                size: 14,
                bold: true
              };
              sheet.getRow(currentRow).height = 25;
              currentRow++;
            });
          }
        }

        // 참고사항을 분리된 행 바로 다음에 A열부터 추가 (각 줄을 별도 행으로)
        if (note && note.trim() !== '') {
          // 줄바꿈으로 분리하여 각 줄을 별도 행으로 추가
          const noteLines = note.split('\n').filter(line => line.trim() !== '');
          let currentRow = separatorRowIndex + 1;
          noteLines.forEach(line => {
            const cell = sheet.getRow(currentRow).getCell(1);
            cell.value = line;
            cell.font = {
              size: 12,
              bold: true
            };
            sheet.getRow(currentRow).height = 20;
            currentRow++;
          });
        }
        
        // 열 너비 조정 (제목 행과 참고사항 행 제외)
        sheet.columns.forEach((column, colIndex) => {
          let maxLength = 0;

          // 2행(헤더)부터 데이터 마지막 행까지만 확인
          const dataEndRow = data.length + 1; // data.length includes title row

          for (let rowNumber = 2; rowNumber <= dataEndRow; rowNumber++) {
            const cell = sheet.getRow(rowNumber).getCell(colIndex + 1);
            if (cell && cell.value) {
              const columnLength = cell.value.toString().length;
              if (columnLength > maxLength) {
                maxLength = columnLength;
              }
            }
          }

          // 상품명과 상품코드 열은 더 넓게 설정
          if (data[1] && colIndex < data[1].length) {
            const headerValue = data[1][colIndex];
            if (headerValue === '상품명') {
              // 상품명 열 너비를 65로 고정
              column.width = 65;
            } else if (headerValue === '상품코드') {
              // 상품코드 열 너비 고정
              column.width = 18;
            } else {
              // 다른 열은 기존대로 설정
              column.width = maxLength < 10 ? 10 : maxLength + 2;
            }
          } else {
            column.width = maxLength < 10 ? 10 : maxLength + 2;
          }
        });
      }
      
      // 메타데이터 추가로 신뢰성 향상
      workbook.properties.title = `${clientName} 피킹데이터`;
      workbook.properties.status = 'Final';
      
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

  // 박스 수량 변경 핸들러
  const handleBoxCountChange = (index, value) => {
    setProcessedFiles(prevFiles => {
      const newFiles = [...prevFiles];
      newFiles[index] = {
        ...newFiles[index],
        boxCount: value
      };
      return newFiles;
    });
  };
  
  return (
    <AuthLayout>
      <Head>
        <title>B2B택배</title>
        <meta name="description" content="물류 엑셀 파일 처리 앱" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
    
      <main className="py-10">
        <div className="max-w-6xl mx-auto bg-white p-8 rounded-lg shadow-md">
          <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">
            B2B 택배
          </h1>
          <p className="text-center text-sm text-gray-500 mb-6">
            오늘 날짜: {new Date().toLocaleDateString()}
          </p>
          <form onSubmit={processFiles} className="space-y-6">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">날짜</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={datePrefix}
                    onChange={(e) => setDatePrefix(e.target.value)}
                    placeholder="예: 3/31"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={setToday}
                    className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors whitespace-nowrap"
                  >
                    오늘
                  </button>
                  <button
                    type="button"
                    onClick={setNextBusinessDay}
                    className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 transition-colors whitespace-nowrap"
                  >
                    내일(영업일)
                  </button>
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">엑셀 파일 업로드</label>
                <input
                  type="file"
                  onChange={handleFilesChange}
                  accept=".xls,.xlsx,.csv"
                  multiple // 다중 파일 업로드 허용
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">참고사항</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="참고사항을 입력하세요"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={4}
              />
              <div className="mt-2 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDutyFree}
                    onChange={(e) => handleDutyFreeChange(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-sm font-medium text-gray-700">면세점 (고정 참고사항 자동 추가)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productMergeMode}
                    onChange={(e) => setProductMergeMode(e.target.checked)}
                    className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                  />
                  <span className="text-sm font-medium text-gray-700">상품별 통합 모드 (동일 상품코드+로케이션 통합)</span>
                </label>
              </div>
            </div>
          
            {error && (
              <div className="p-3 bg-red-100 text-red-700 rounded-md">
                {error}
              </div>
            )}
          
            {success && !processedFiles.length && (
              <div className="p-3 bg-green-100 text-green-700 rounded-md">
                파일이 성공적으로 업로드되었습니다.
              </div>
            )}
          
            <div className="flex">
              <button
                type="submit"
                disabled={processing || !files.length}
                className={`w-full py-2 px-4 rounded-md text-white font-medium ${
                  processing || !files.length
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {processing ? '처리 중...' : '파일 처리하기'}
              </button>
            </div>
          </form>
        
          {processedFiles.length > 0 && (
            <div className="mt-6 border-t pt-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">파일 처리 결과</h2>
            
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      거래처
                    </label>
                    <input
                      type="text"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* 파일 리스트 및 각 파일별 상세 정보 */}
                <div className="mt-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">파일 리스트</h3>
                  {processedFiles.map((file, index) => (
                    <div key={index} className="mb-6 bg-gray-50 p-4 rounded-md border border-gray-200">
                      <div className="flex flex-col md:flex-row justify-between items-start mb-3">
                        <div>
                          <p className="text-sm font-semibold">{file.fileName}</p>
                          <p className="text-xs text-gray-500">
                            {file.originalClientName && file.originalClientName !== file.clientName ? 
                              `거래처: ${file.clientName} (원본: ${file.originalClientName})` :
                              `거래처: ${file.clientName}`
                            }
                          </p>
                        </div>
                        <div className="mt-2 md:mt-0 flex items-center gap-2">
                          <label className="text-sm font-medium whitespace-nowrap">박스 수:</label>
                          <input
                            type="text"
                            value={file.boxCount}
                            onChange={(e) => handleBoxCountChange(index, e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded-md w-20"
                          />
                          <span className="text-xs text-gray-500">
                            (계산값: {file.boxCalculation.totalBoxes})
                          </span>
                        </div>
                      </div>
                      
                      {file.boxCalculation.calculationDetails.length > 0 && (
                        <div className="overflow-x-auto mb-4">
                          <h4 className="text-xs font-medium text-gray-700 mb-1">박스 계산 상세</h4>
                          <table className="min-w-full text-xs border-collapse">
                            <thead>
                              <tr className="bg-gray-100">
                                <th className="text-left py-1 px-2 border border-gray-200">상품코드</th>
                                <th className="text-left py-1 px-2 border border-gray-200">상품명</th>
                                <th className="text-right py-1 px-2 border border-gray-200">수량</th>
                                <th className="text-right py-1 px-2 border border-gray-200">EA/BOX</th>
                                <th className="text-right py-1 px-2 border border-gray-200">박스 수</th>
                                <th className="text-right py-1 px-2 border border-gray-200">무게(kg)</th>
                                <th className="text-center py-1 px-2 border border-gray-200">박스타입</th>
                              </tr>
                            </thead>
                            <tbody>
                              {file.boxCalculation.calculationDetails.map((detail, detailIdx) => (
                                <tr key={detailIdx} className="border-b border-gray-200">
                                  <td className="py-1 px-2 border border-gray-200">{detail.productCode}</td>
                                  <td className="py-1 px-2 border border-gray-200">{detail.productName}</td>
                                  <td className="text-right py-1 px-2 border border-gray-200">{detail.quantity}</td>
                                  <td className="text-right py-1 px-2 border border-gray-200">{detail.eaPerBox || '-'}</td>
                                  <td className="text-right py-1 px-2 border border-gray-200">{detail.boxCount || '-'}</td>
                                  <td className="text-right py-1 px-2 border border-gray-200">{detail.actualWeight ? detail.actualWeight.toFixed(2) : '-'}</td>
                                  <td className="text-center py-1 px-2 border border-gray-200">{detail.boxType || '-'}</td>
                                </tr>
                              ))}
                              <tr className="font-semibold bg-gray-50">
                                <td colSpan="2" className="py-1 px-2 border border-gray-200">합계</td>
                                <td className="text-right py-1 px-2 border border-gray-200">{file.boxCalculation.totalQuantity}</td>
                                <td className="text-right py-1 px-2 border border-gray-200"></td>
                                <td className="text-right py-1 px-2 border border-gray-200">{file.boxCalculation.totalBoxes}</td>
                                <td className="text-right py-1 px-2 border border-gray-200"></td>
                                <td className="text-center py-1 px-2 border border-gray-200"></td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* 피킹 데이터 미리보기 테이블 추가 */}
                      {file.processedData && file.processedData.length > 2 && (
                        <div className="overflow-x-auto mt-4">
                          <h4 className="text-xs font-medium text-gray-700 mb-1">
                            피킹 데이터 미리보기 
                            <span className="text-orange-600 font-semibold">(노란 배경: 27년 미만 유통기한)</span>
                          </h4>
                          <div className="max-h-64 overflow-y-auto">
                            <table className="min-w-full text-xs border-collapse">
                              <thead className="sticky top-0 bg-white">
                                <tr className="bg-gray-100">
                                  {file.processedData[1] && file.processedData[1].map((header, headerIdx) => (
                                    <th key={headerIdx} className="text-left py-1 px-2 border border-gray-200">
                                      {header}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {file.processedData.slice(2).map((row, rowIdx) => {
                                  // 유통기한 열 인덱스 찾기
                                  const expiryDateIndex = file.processedData[1] ?
                                    file.processedData[1].findIndex(header =>
                                      header && header.toString().includes('유통기한')
                                    ) : -1;

                                  // 유통기한 하이라이트 확인 ('yellow', 'orange', null)
                                  const highlightType = expiryDateIndex !== -1 ?
                                    checkExpiryDateHighlight(row[expiryDateIndex]) : null;

                                  return (
                                    <tr
                                      key={rowIdx}
                                      className={`border-b border-gray-200 ${
                                        highlightType === 'yellow' ? 'bg-yellow-100' :
                                        highlightType === 'orange' ? 'bg-orange-100' : ''
                                      }`}
                                    >
                                      {row.map((cell, cellIdx) => (
                                        <td
                                          key={cellIdx}
                                          className={`py-1 px-2 border border-gray-200 ${
                                            highlightType === 'yellow' ? 'text-yellow-800' :
                                            highlightType === 'orange' ? 'text-orange-800' : ''
                                          }`}
                                        >
                                          {cell}
                                        </td>
                                      ))}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-2">
                  <button
                    onClick={exportExcel}
                    disabled={processing}
                    className={`w-full py-2 px-4 rounded-md text-white font-medium ${
                      processing
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-green-600 hover:bg-green-700'
                    }`}
                  >
                    {processing ? '처리 중...' : '엑셀 내보내기'}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 p-4 bg-gray-100 rounded-md">
            <h2 className="text-lg font-semibold text-gray-700 mb-2">
              사용 방법
            </h2>
            <ol className="list-decimal list-inside space-y-1 text-gray-600">
              <li>날짜를 입력합니다 (예: 3/31)</li>
              <li>처리할 엑셀 파일을 하나 이상 업로드하고 파일 처리하기 클릭</li>
              <li>필요한 경우 참고사항을 입력합니다</li>
              <li>추출된 거래처와 각 파일별 박스 수 정보를 확인 및 필요시 수정</li>
              <li><span className="font-semibold text-orange-600">27년 미만 유통기한은 노란색 배경으로 표시됩니다</span></li>
              <li>엑셀 내보내기 버튼을 클릭하여 모든 파일이 포함된 최종 엑셀 파일 다운로드</li>
            </ol>
            <p className="mt-3 text-sm text-gray-500">
              여러 파일을 선택한 경우 하나의 엑셀 파일에 각각 별도 시트로 저장됩니다.<br />
              피킹지 시트: 상품코드, 상품명, 유통기한, LOT, 다중로케이션, 정상수량, 박스타입<br />
              파일명: [날짜][거래처명]_B2B택배.xlsx 형식으로 저장됩니다.<br />
              거래처명에서 &apos;주식회사&apos; 텍스트는 자동으로 제거됩니다.<br />
              피킹지 데이터는 로케이션(AA-10-16-04) 순으로 정렬됩니다.<br />
              <span className="font-semibold text-orange-600">
                ⚠️ 27년 미만 유통기한: 웹페이지와 엑셀 파일 모두에서 노란색 배경으로 표시됩니다.
              </span>
            </p>
            <div className="mt-4 p-3 bg-purple-50 rounded border border-purple-200">
              <h3 className="text-sm font-semibold text-purple-700 mb-1">상품별 통합 모드</h3>
              <p className="text-sm text-purple-600">
                여러 엑셀 파일에서 동일한 상품코드+로케이션을 가진 항목들을 하나의 시트로 통합합니다.<br />
                예: 10개 파일에 A상품이 각각 있다면, A상품 피킹지 1개 시트에 모든 수량이 표시됩니다.<br />
                시트 수는 고유한 상품코드+로케이션 조합 개수만큼 생성됩니다.
              </p>
            </div>
          </div>
        </div>
      </main>
    </AuthLayout>
  );
}
