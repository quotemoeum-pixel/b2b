// pages/warehouse/index.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import AuthLayout from '@/components/AuthLayout';
import { useAuth } from '../_app';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function WarehouseMovement() {
  const [activeTab, setActiveTab] = useState('input'); // 'input', 'search'
  const [erpNumber, setErpNumber] = useState(''); // ERP 요청번호
  const [manager, setManager] = useState(''); // 담당자
  const [datePrefix, setDatePrefix] = useState('');
  const [clientName, setClientName] = useState('');
  const [movementTitle, setMovementTitle] = useState(''); // 이동 템플릿 제목
  const [fromLocation, setFromLocation] = useState(''); // 출발지
  const [toLocation, setToLocation] = useState(''); // 도착지
  const [files, setFiles] = useState([]);

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const [processedFiles, setProcessedFiles] = useState([]);
  const [previewData, setPreviewData] = useState(null); // 미리보기 데이터

  // 조회 탭 상태
  const [searchErpNumber, setSearchErpNumber] = useState('');
  const [allRequests, setAllRequests] = useState([]); // 전체 요청 리스트
  const [filteredRequests, setFilteredRequests] = useState([]); // 필터링된 리스트
  const [selectedRequest, setSelectedRequest] = useState(null); // 선택된 요청의 상세 (반출전표)
  const [searching, setSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all'); // 상태 필터: 'all', '대기중', '완료'

  // 입고전표 편집 상태
  const [editableData, setEditableData] = useState([]); // 편집 가능한 데이터
  const [isEditing, setIsEditing] = useState(false);
  const [duplicateLocations, setDuplicateLocations] = useState(new Set()); // 중복 로케이션
  const [quantityMismatches, setQuantityMismatches] = useState([]); // 수량 불일치 목록

  const router = useRouter();
  const { isLoggedIn, loading, user } = useAuth();

  useEffect(() => {
    if (!loading && !isLoggedIn) {
      router.push('/login');
    }
  }, [isLoggedIn, loading, router]);

  // 조회 탭으로 전환 시 자동으로 전체 리스트 로드
  useEffect(() => {
    if (activeTab === 'search' && allRequests.length === 0) {
      loadAllRequests();
    }
  }, [activeTab]);

  // 검색어나 상태 필터 변경 시 리스트 필터링
  useEffect(() => {
    filterRequests();
  }, [searchErpNumber, statusFilter, allRequests]);

  // 리스트 필터링 함수
  const filterRequests = () => {
    let filtered = [...allRequests];

    // ERP 번호로 필터링
    if (searchErpNumber.trim()) {
      filtered = filtered.filter(r =>
        r.erp_number.toLowerCase().includes(searchErpNumber.toLowerCase())
      );
    }

    // 상태로 필터링
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    setFilteredRequests(filtered);
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!isLoggedIn) {
    return null;
  }

  // 오늘 날짜를 m/d 형식으로 반환
  const formatDate = (date) => {
    return `${date.getMonth() + 1}/${date.getDate()}`;
  };

  // 출발지/도착지 선택 시 제목 업데이트
  const updateTitle = (from, to) => {
    if (from && to) {
      const today = new Date();
      const formattedDate = formatDate(today);
      setDatePrefix(formattedDate);
      setMovementTitle(`${formattedDate} ${from} -> ${to} 재고이동`);
    }
  };

  // 출발지 선택
  const handleFromLocation = (location) => {
    setFromLocation(location);
    updateTitle(location, toLocation);
  };

  // 도착지 선택
  const handleToLocation = (location) => {
    setToLocation(location);
    updateTitle(fromLocation, location);
  };

  const handleFilesChange = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(selectedFiles);
    setSuccess(false);
    setError('');
  };

  const processFiles = async (e) => {
    e.preventDefault();

    if (!erpNumber || erpNumber.trim() === '') {
      setError('ERP 요청번호를 입력해주세요.');
      return;
    }

    if (files.length === 0) {
      setError('파일을 선택해주세요.');
      return;
    }

    setProcessing(true);
    setError('');

    try {
      const processedFilesData = [];
      const allDetailsData = []; // 미리보기용 상세 데이터

      for (const file of files) {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        console.log('엑셀 데이터:', jsonData);

        const result = processData(jsonData);

        const cleanedClientName = removeCompanyPrefix(result.clientName);

        // 상세 데이터 추출 (미리보기용)
        const detailsData = extractDetailsData(jsonData);
        allDetailsData.push(...detailsData);

        processedFilesData.push({
          fileName: file.name,
          originalData: jsonData,
          processedData: result.processedData,
          originalClientName: result.clientName,
          clientName: cleanedClientName,
          detailsData: detailsData
        });
      }

      setProcessedFiles(processedFilesData);
      setPreviewData(allDetailsData); // 미리보기 데이터 설정

      if (processedFilesData.length > 0 && processedFilesData[0].clientName) {
        setClientName(processedFilesData[0].clientName);
      }

      setSuccess(true);
    } catch (err) {
      console.error('Error processing files:', err);
      setError('파일 처리 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 엑셀에서 상세 데이터 추출 (DB 저장용)
  const extractDetailsData = (jsonData) => {
    const details = [];
    const headerRowIndex = 1;

    for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
      const row = jsonData[i];
      if (!row || row.length === 0) continue;
      if (row.every(cell => !cell && cell !== 0)) continue; // 빈 행 스킵

      // 마지막 합계 행 감지 및 스킵
      // 합계 행은 보통 첫 번째 열이 숫자 0이고, 상품코드/상품명이 비어있음
      const firstCell = row[0];
      const productCode = row[3];
      const productName = row[4];

      // 첫 번째 열이 0이고 상품 정보가 없으면 합계 행으로 간주
      if ((firstCell === 0 || firstCell === '0') && !productCode && !productName) {
        console.log('합계 행 제외:', row);
        continue;
      }

      // 헤더: ['선택', 'ERP요청순번', '거래처', '상품코드', '상품명', '바코드', '유통기한', 'LOT', '예정수량', '정상수량', '정상다중로케이션', ...]
      const detail = {
        erpSeqNumber: row[1] || 0,
        productCode: row[3] || '',
        productName: row[4] || '',
        barcode: row[5] || '',
        expiryDate: row[6] || '',
        lot: row[7] || '',
        scheduledQuantity: row[8] || 0,
        normalQuantity: row[9] || 0,
        normalLocation: row[10] || ''
      };

      details.push(detail);
    }

    return details;
  };

  const removeCompanyPrefix = (name) => {
    if (!name) return name;
    return name.replace(/주식회사/g, '').trim();
  };

  // 파렛트 수 계산 (고유 로케이션 개수)
  const calculatePalletCount = (details) => {
    if (!details || details.length === 0) return 0;
    const uniqueLocations = new Set();
    details.forEach(item => {
      const location = item.normalLocation || item.normal_location || '';
      if (location && location.trim()) {
        uniqueLocations.add(location.trim());
      }
    });
    return uniqueLocations.size;
  };

  const processData = (data) => {
    try {
      if (!data || !Array.isArray(data) || data.length < 2) {
        throw new Error('파일 형식이 올바르지 않습니다. 최소 2행이 필요합니다.');
      }

      let clientName = '';
      const headerRow = 1;

      const columnsToFind = [
        '상품코드', '상품명', '유통기한', 'lot', '정상수량', '다중로케이션'
      ];

      let clientColumnIndex = -1;
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

          if (cellValueStr.includes('거래처')) {
            clientColumnIndex = i;
          }

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

      const normalQuantityIndex = headerIndexMap['정상수량'];

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

      const sheetData = createSheetData(data, headerRow, headerIndexMap, datePrefix, clientName, normalQuantityIndex);

      return {
        processedData: sheetData,
        clientName
      };
    } catch (error) {
      console.error('Error in processData:', error);
      throw error;
    }
  };

  const createSheetData = (data, headerRow, headerIndexMap, datePrefix, clientName, normalQuantityIndex) => {
    try {
      if (!data || !Array.isArray(data) || !headerIndexMap) {
        console.error('Invalid data or headerIndexMap in createSheetData', { data, headerIndexMap });
        return [[]];
      }

      // 적치 로케이션 열 추가
      const newHeaders = ['상품코드', '상품명', '유통기한', 'LOT', '다중로케이션', '정상수량', '적치 로케이션']
        .filter(col => {
          if (col === '적치 로케이션') return true; // 항상 포함
          if (col === 'LOT') return headerIndexMap['lot'] !== undefined;
          return headerIndexMap[col] !== undefined;
        });

      const newData = [];
      const cleanedClientName = removeCompanyPrefix(clientName);

      if (datePrefix && cleanedClientName) {
        newData.push([`${datePrefix} ${cleanedClientName} 창고이동`]);
      } else {
        newData.push(['']);
      }

      newData.push(newHeaders);

      const rows = [];
      const locationColumnIndex = headerIndexMap['다중로케이션'];

      for (let i = headerRow + 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !Array.isArray(row) || row.every(cell => !cell)) continue;

        if (normalQuantityIndex !== undefined) {
          const quantity = row[normalQuantityIndex];
          if (quantity === 0 || quantity === '0') continue;
        }

        const newRow = newHeaders.map(col => {
          if (col === '적치 로케이션') return ''; // 빈 열 추가
          const colName = col === 'LOT' ? 'lot' : col;
          const colIndex = headerIndexMap[colName];
          return (colIndex !== undefined && row[colIndex] !== undefined) ? row[colIndex] || '' : '';
        });

        if (newRow.some(cell => cell)) {
          const location = locationColumnIndex !== undefined ? row[locationColumnIndex] : '';
          // 정렬용 데이터 추출
          const productCodeIdx = headerIndexMap['상품코드'];
          const expiryDateIdx = headerIndexMap['유통기한'];
          const lotIdx = headerIndexMap['lot'];

          const productCode = productCodeIdx !== undefined ? (row[productCodeIdx] || '') : '';

          // 상품코드가 비어있으면 합계 행으로 간주하고 제외
          if (!productCode || productCode.toString().trim() === '') {
            continue;
          }

          rows.push({
            data: newRow,
            location: location || '',
            productCode: productCode,
            expiryDate: expiryDateIdx !== undefined ? (row[expiryDateIdx] || '') : '',
            lot: lotIdx !== undefined ? (row[lotIdx] || '') : ''
          });
        }
      }

      // 1단계: 상품코드 → 유통기한 → LOT 순으로 정렬 (기존 정렬)
      rows.sort((a, b) => {
        const codeA = (a.productCode || '').toString();
        const codeB = (b.productCode || '').toString();
        if (codeA !== codeB) return codeA.localeCompare(codeB);

        const expiryA = (a.expiryDate || '').toString();
        const expiryB = (b.expiryDate || '').toString();
        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);

        const lotA = (a.lot || '').toString();
        const lotB = (b.lot || '').toString();
        return lotA.localeCompare(lotB);
      });

      // 2단계: 같은 로케이션끼리 그룹핑 (첫 등장 위치 기준)
      const groupedRows = [];
      const locationFirstIndex = new Map();

      rows.forEach(row => {
        const loc = (row.location || '').trim();
        if (!locationFirstIndex.has(loc)) {
          locationFirstIndex.set(loc, groupedRows.length);
          groupedRows.push(row);
        } else {
          const firstIdx = locationFirstIndex.get(loc);
          let insertIdx = firstIdx + 1;
          while (insertIdx < groupedRows.length &&
                 (groupedRows[insertIdx].location || '').trim() === loc) {
            insertIdx++;
          }
          groupedRows.splice(insertIdx, 0, row);
          locationFirstIndex.forEach((idx, key) => {
            if (idx >= insertIdx && key !== loc) {
              locationFirstIndex.set(key, idx + 1);
            }
          });
        }
      });

      for (const row of groupedRows) {
        newData.push(row.data);
      }

      return newData;
    } catch (error) {
      console.error('Error in createSheetData:', error);
      return [['오류가 발생했습니다']];
    }
  };

  const downloadMultiSheetExcel = async (processedFiles, fileName, datePrefix, clientName, palletCount) => {
    try {
      if (!processedFiles || !Array.isArray(processedFiles) || processedFiles.length === 0) {
        console.error('Invalid processed files structure for Excel file', processedFiles);
        throw new Error('엑셀 파일을 생성할 수 없습니다: 처리된 파일이 없습니다.');
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = '창고이동 엑셀 프로세서';
      workbook.created = new Date();

      for (let i = 0; i < processedFiles.length; i++) {
        const processedFile = processedFiles[i];
        const sheetName = `피킹지 ${i + 1}`;
        const sheet = workbook.addWorksheet(sheetName);

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

        // movementTitle이 있으면 사용, 없으면 기존 방식 사용 (파렛트 수 포함)
        let titleText = '';
        if (movementTitle && movementTitle.trim() !== '') {
          titleText = `${movementTitle} ${palletCount}PLT`;
        } else if (datePrefix && clientName) {
          titleText = `${datePrefix} ${clientName} 창고이동 ${palletCount}PLT`;
        }

        const data = processedFile.processedData;
        if (data.length > 1) {
          const titleRow = sheet.addRow([titleText]);
          titleRow.font = {
            size: 24,
            bold: true
          };
          titleRow.height = 40;

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
          });

          // 다중로케이션 열 인덱스 찾기
          const locationColIndex = data[1].indexOf('다중로케이션');

          // 로케이션별 개수 계산 (2개 이상이면 하이라이트 대상)
          const locationCount = new Map();
          for (let i = 2; i < data.length; i++) {
            const loc = locationColIndex >= 0 ? (data[i][locationColIndex] || '').toString().trim() : '';
            locationCount.set(loc, (locationCount.get(loc) || 0) + 1);
          }

          const highlightColor = 'FFE3F2FD'; // 연한 파란색

          // 정상수량 열 인덱스 찾기
          const quantityColIndex = data[1].indexOf('정상수량');
          let totalQuantity = 0;

          for (let i = 2; i < data.length; i++) {
            // 현재 행의 로케이션 값
            const currentLocation = locationColIndex >= 0 ? (data[i][locationColIndex] || '').toString().trim() : '';

            // 같은 로케이션이 2개 이상이면 하이라이트
            const shouldHighlight = locationCount.get(currentLocation) >= 2;

            // 정상수량 합계 계산
            if (quantityColIndex >= 0) {
              const qty = parseFloat(data[i][quantityColIndex]) || 0;
              totalQuantity += qty;
            }

            const rowData = sheet.addRow(data[i]);

            rowData.eachCell((cell, colNumber) => {
              cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
              };
              // 로케이션 열에만 하이라이트 적용 (같은 로케이션이 2개 이상일 때)
              if (colNumber === locationColIndex + 1 && shouldHighlight) {
                cell.fill = {
                  type: 'pattern',
                  pattern: 'solid',
                  fgColor: { argb: highlightColor }
                };
              }
              // 정상수량 열에 천단위 콤마 포맷 적용
              if (colNumber === quantityColIndex + 1) {
                cell.numFmt = '#,##0';
                cell.alignment = { horizontal: 'right' };
              }
            });
          }

          // 합계 행 추가
          const totalRowData = new Array(data[1].length).fill('');
          if (locationColIndex >= 0) {
            totalRowData[locationColIndex] = '합계';
          }
          if (quantityColIndex >= 0) {
            totalRowData[quantityColIndex] = totalQuantity;
          }

          const totalRow = sheet.addRow(totalRowData);
          totalRow.eachCell((cell, colNumber) => {
            cell.font = { bold: true };
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFFFF2CC' } // 연한 노란색 배경
            };
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
            // 합계 수량 열에 천단위 콤마 포맷 적용
            if (colNumber === quantityColIndex + 1) {
              cell.numFmt = '#,##0';
              cell.alignment = { horizontal: 'right' };
            }
          });
        }

        // 열 너비 조정
        sheet.columns.forEach((column, colIndex) => {
          let maxLength = 0;

          const dataEndRow = data.length + 1;

          for (let rowNumber = 2; rowNumber <= dataEndRow; rowNumber++) {
            const cell = sheet.getRow(rowNumber).getCell(colIndex + 1);
            if (cell && cell.value) {
              const columnLength = cell.value.toString().length;
              if (columnLength > maxLength) {
                maxLength = columnLength;
              }
            }
          }

          if (data[1] && colIndex < data[1].length) {
            const headerValue = data[1][colIndex];
            if (headerValue === '상품명') {
              column.width = 65;
            } else if (headerValue === '상품코드') {
              column.width = Math.min(18, Math.max(12, maxLength + 2));
            } else if (headerValue === '적치 로케이션') {
              column.width = 20;
            } else {
              column.width = maxLength < 10 ? 10 : maxLength + 2;
            }
          } else {
            column.width = maxLength < 10 ? 10 : maxLength + 2;
          }
        });
      }

      workbook.properties.title = `${clientName} 창고이동`;
      workbook.properties.status = 'Final';

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('엑셀 다운로드 오류:', err);
      throw new Error('엑셀 파일 생성 중 오류가 발생했습니다: ' + err.message);
    }
  };

  // 합계 수량(EA) 계산
  const calculateTotalQuantity = (processedFiles) => {
    let total = 0;
    processedFiles.forEach(file => {
      if (file.detailsData) {
        file.detailsData.forEach(detail => {
          // 정상수량만 합산 (마지막 합계 행은 이미 extractDetailsData에서 제외됨)
          if (detail.normalQuantity && !isNaN(detail.normalQuantity)) {
            total += Number(detail.normalQuantity);
          }
        });
      }
    });
    return total;
  };

  // 날짜를 yymmdd 형식으로 변환
  const formatDateForFileNameYYMMDD = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('/');
    if (parts.length === 2) {
      const today = new Date();
      const year = today.getFullYear().toString().slice(-2); // 마지막 2자리
      const month = parts[0].padStart(2, '0');
      const day = parts[1].padStart(2, '0');
      return `${year}${month}${day}`;
    }
    return dateStr;
  };

  // DB에 저장
  const saveToDatabase = async () => {
    if (!erpNumber || erpNumber.trim() === '') {
      setError('ERP 요청번호를 입력해주세요.');
      return;
    }

    if (!processedFiles.length) {
      setError('먼저 파일을 처리해주세요.');
      return;
    }

    if (!fromLocation || !toLocation) {
      setError('출발지와 도착지를 선택해주세요.');
      return;
    }

    setProcessing(true);
    try {
      // 합계 수량 계산
      const totalEA = calculateTotalQuantity(processedFiles);

      // 1. erp_requests 테이블에 저장 (중복 허용)
      const { data: erpRequestData, error: erpError } = await supabase
        .from('erp_requests')
        .insert([
          {
            erp_number: erpNumber,
            manager: manager || null,
            from_location: fromLocation,
            to_location: toLocation,
            total_ea: totalEA,
            status: '대기중',
            created_by: user?.id || null,
            created_by_email: user?.email || null
          }
        ])
        .select();

      if (erpError) {
        console.error('ERP 요청 저장 오류:', erpError);
        throw erpError;
      }

      const erpRequestId = erpRequestData[0].id;

      // 2. erp_request_details 테이블에 상세 데이터 저장
      const allDetails = [];
      processedFiles.forEach(file => {
        if (file.detailsData) {
          file.detailsData.forEach(detail => {
            allDetails.push({
              erp_request_id: erpRequestId,
              erp_seq_number: detail.erpSeqNumber,
              product_code: detail.productCode,
              product_name: detail.productName,
              barcode: detail.barcode,
              expiry_date: detail.expiryDate,
              lot: detail.lot,
              scheduled_quantity: detail.scheduledQuantity,
              normal_quantity: detail.normalQuantity,
              normal_location: detail.normalLocation
            });
          });
        }
      });

      const { error: detailsError } = await supabase
        .from('erp_request_details')
        .insert(allDetails);

      if (detailsError) {
        console.error('상세 데이터 저장 오류:', detailsError);
        throw detailsError;
      }

      setSuccess(true);
      setError('');
      alert(`저장 완료!\nERP 요청번호: ${erpNumber}\n총 ${allDetails.length}개 항목이 저장되었습니다.`);
    } catch (err) {
      console.error('Error saving to database:', err);
      setError('데이터 저장 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 전체 리스트 조회
  const loadAllRequests = async () => {
    setSearching(true);
    setError('');
    setSelectedRequest(null);

    try {
      const { data: erpData, error: erpError } = await supabase
        .from('erp_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100); // 최근 100개

      if (erpError) {
        throw erpError;
      }

      setAllRequests(erpData || []);
      setFilteredRequests(erpData || []);
    } catch (err) {
      console.error('Error loading all requests:', err);
      setError('조회 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setSearching(false);
    }
  };

  // 요청 삭제
  const deleteRequest = async (requestId, e) => {
    e.stopPropagation(); // 클릭 이벤트 전파 방지

    if (!window.confirm('정말 삭제하시겠습니까?\n관련된 상세 데이터도 함께 삭제됩니다.')) {
      return;
    }

    setProcessing(true);
    try {
      // 상세 데이터 먼저 삭제 (FK 제약 때문에)
      const { error: detailsError } = await supabase
        .from('erp_request_details')
        .delete()
        .eq('erp_request_id', requestId);

      if (detailsError) {
        throw detailsError;
      }

      // 요청 삭제
      const { error: requestError } = await supabase
        .from('erp_requests')
        .delete()
        .eq('id', requestId);

      if (requestError) {
        throw requestError;
      }

      // 리스트에서 제거
      setAllRequests(prev => prev.filter(r => r.id !== requestId));

      // 선택된 요청이 삭제된 경우 초기화
      if (selectedRequest && selectedRequest.request.id === requestId) {
        setSelectedRequest(null);
        setEditableData([]);
      }

      alert('삭제되었습니다.');
    } catch (err) {
      console.error('Error deleting request:', err);
      setError('삭제 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 상태 토글 (대기중 <-> 완료)
  const toggleStatus = async (requestId, currentStatus, e) => {
    e.stopPropagation(); // 클릭 이벤트 전파 방지

    const newStatus = currentStatus === '완료' ? '대기중' : '완료';

    setProcessing(true);
    try {
      const { error: updateError } = await supabase
        .from('erp_requests')
        .update({ status: newStatus })
        .eq('id', requestId);

      if (updateError) {
        throw updateError;
      }

      // 로컬 상태 업데이트
      setAllRequests(prev => prev.map(r =>
        r.id === requestId ? { ...r, status: newStatus } : r
      ));

    } catch (err) {
      console.error('Error updating status:', err);
      setError('상태 변경 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 특정 요청의 상세 내역 조회
  const loadRequestDetails = async (requestId) => {
    setProcessing(true);
    try {
      const { data: detailsData, error: detailsError } = await supabase
        .from('erp_request_details')
        .select('*')
        .eq('erp_request_id', requestId)
        .order('erp_seq_number', { ascending: true });

      if (detailsError) {
        throw detailsError;
      }

      const selectedReq = allRequests.find(r => r.id === requestId);

      // 1단계: 상품코드 → 유통기한 → LOT 순으로 정렬
      const tempSorted = [...detailsData].sort((a, b) => {
        const codeA = (a.product_code || '').toString();
        const codeB = (b.product_code || '').toString();
        if (codeA !== codeB) return codeA.localeCompare(codeB);

        const expiryA = (a.expiry_date || '').toString();
        const expiryB = (b.expiry_date || '').toString();
        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);

        const lotA = (a.lot || '').toString();
        const lotB = (b.lot || '').toString();
        return lotA.localeCompare(lotB);
      });

      // 2단계: 같은 로케이션끼리 그룹핑 (첫 등장 위치 기준)
      const sortedDetails = [];
      const locationFirstIndex = new Map();

      tempSorted.forEach(item => {
        const loc = (item.normal_location || '').trim();
        if (!locationFirstIndex.has(loc)) {
          locationFirstIndex.set(loc, sortedDetails.length);
          sortedDetails.push(item);
        } else {
          const firstIdx = locationFirstIndex.get(loc);
          let insertIdx = firstIdx + 1;
          while (insertIdx < sortedDetails.length &&
                 (sortedDetails[insertIdx].normal_location || '').trim() === loc) {
            insertIdx++;
          }
          sortedDetails.splice(insertIdx, 0, item);
          locationFirstIndex.forEach((idx, key) => {
            if (idx >= insertIdx && key !== loc) {
              locationFirstIndex.set(key, idx + 1);
            }
          });
        }
      });

      setSelectedRequest({
        request: selectedReq,
        details: sortedDetails
      });

      // 편집 가능한 데이터 초기화 (적치로케이션 추가)
      const editableDetails = sortedDetails.map(item => ({
        ...item,
        storage_location: '' // 입고 시 입력할 적치로케이션
      }));
      setEditableData(editableDetails);
      setIsEditing(false);
    } catch (err) {
      console.error('Error loading details:', err);
      setError('상세 내역 조회 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 편집 모드 시작
  const startEditing = () => {
    setIsEditing(true);
  };

  // 편집 모드 취소
  const cancelEditing = () => {
    if (selectedRequest) {
      const editableDetails = selectedRequest.details.map(item => ({
        ...item,
        storage_location: ''
      }));
      setEditableData(editableDetails);
    }
    setIsEditing(false);
  };

  // 적치로케이션 자동 포맷팅 (AA-01-01-01 형식)
  const formatStorageLocation = (value) => {
    // 숫자와 알파벳만 추출
    const cleaned = value.replace(/[^A-Za-z0-9]/g, '');

    if (cleaned.length === 0) return '';

    // AA-01-01-01 형식으로 변환
    let formatted = '';

    // 첫 2글자: 알파벳 (AA, BB 등)
    if (cleaned.length >= 1) {
      formatted += cleaned.substring(0, 2).toUpperCase();
    }

    // 다음 2글자: 숫자 (01)
    if (cleaned.length > 2) {
      formatted += '-' + cleaned.substring(2, 4);
    }

    // 다음 2글자: 숫자 (01)
    if (cleaned.length > 4) {
      formatted += '-' + cleaned.substring(4, 6);
    }

    // 다음 2글자: 숫자 (01)
    if (cleaned.length > 6) {
      formatted += '-' + cleaned.substring(6, 8);
    }

    return formatted;
  };

  // 셀 값 변경
  const handleCellChange = (index, field, value) => {
    const newData = [...editableData];

    // 적치로케이션 입력 시 자동 포맷팅
    if (field === 'storage_location') {
      value = formatStorageLocation(value);
    }

    newData[index] = {
      ...newData[index],
      [field]: value
    };
    setEditableData(newData);

    // 로케이션 변경 시 중복 체크
    if (field === 'storage_location') {
      checkDuplicateLocations(newData);
    }
  };

  // 중복 로케이션 체크
  const checkDuplicateLocations = (data) => {
    const locationCount = {};
    const duplicates = new Set();

    data.forEach(item => {
      if (item.storage_location && item.storage_location.trim()) {
        const loc = item.storage_location.trim();
        locationCount[loc] = (locationCount[loc] || 0) + 1;
      }
    });

    Object.keys(locationCount).forEach(loc => {
      if (locationCount[loc] > 1) {
        duplicates.add(loc);
      }
    });

    setDuplicateLocations(duplicates);
  };

  // 수량 검증 (상품코드별 예정수량 합 = 정상수량 합)
  const validateQuantities = () => {
    const productQuantities = {};

    // 상품코드별로 예정수량과 정상수량 집계
    editableData.forEach(item => {
      const code = item.product_code;
      if (!productQuantities[code]) {
        productQuantities[code] = {
          productName: item.product_name,
          scheduledTotal: 0,
          normalTotal: 0
        };
      }
      productQuantities[code].scheduledTotal += Number(item.scheduled_quantity) || 0;
      productQuantities[code].normalTotal += Number(item.normal_quantity) || 0;
    });

    // 불일치 찾기
    const mismatches = [];
    Object.keys(productQuantities).forEach(code => {
      const { productName, scheduledTotal, normalTotal } = productQuantities[code];
      if (scheduledTotal !== normalTotal) {
        mismatches.push({
          productCode: code,
          productName: productName,
          scheduledTotal: scheduledTotal,
          normalTotal: normalTotal,
          difference: normalTotal - scheduledTotal
        });
      }
    });

    setQuantityMismatches(mismatches);
    return mismatches.length === 0;
  };

  // 입고전표 클립보드 복사 (바코드, ERP순번, 적치로케이션, 유통기한, LOT, 정상수량)
  const copyReceiptToClipboard = async () => {
    if (editableData.length === 0) {
      setError('입고전표 데이터가 없습니다.');
      return;
    }

    // 수량 검증
    const isValid = validateQuantities();
    if (!isValid) {
      const confirmCopy = window.confirm(
        '상품코드별 예정수량과 정상수량이 일치하지 않습니다.\n그래도 복사하시겠습니까?'
      );
      if (!confirmCopy) return;
    }

    try {
      // 1단계: 상품코드 → 유통기한 → LOT 순으로 정렬 (기존 정렬)
      const tempSorted = [...editableData].sort((a, b) => {
        const codeA = (a.product_code || '').toString();
        const codeB = (b.product_code || '').toString();
        if (codeA !== codeB) return codeA.localeCompare(codeB);

        const expiryA = (a.expiry_date || '').toString();
        const expiryB = (b.expiry_date || '').toString();
        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);

        const lotA = (a.lot || '').toString();
        const lotB = (b.lot || '').toString();
        return lotA.localeCompare(lotB);
      });

      // 2단계: 같은 로케이션끼리 그룹핑 (첫 등장 위치 기준)
      const sortedData = [];
      const locationFirstIndex = new Map();

      tempSorted.forEach(item => {
        const loc = (item.normal_location || '').trim();
        if (!locationFirstIndex.has(loc)) {
          locationFirstIndex.set(loc, sortedData.length);
          sortedData.push(item);
        } else {
          const firstIdx = locationFirstIndex.get(loc);
          let insertIdx = firstIdx + 1;
          while (insertIdx < sortedData.length &&
                 (sortedData[insertIdx].normal_location || '').trim() === loc) {
            insertIdx++;
          }
          sortedData.splice(insertIdx, 0, item);
          locationFirstIndex.forEach((idx, key) => {
            if (idx >= insertIdx && key !== loc) {
              locationFirstIndex.set(key, idx + 1);
            }
          });
        }
      });

      // 탭으로 구분된 데이터 생성 (엑셀 붙여넣기 형식)
      const rows = sortedData.map(item => {
        return [
          item.barcode || '',
          item.erp_seq_number || 0,
          item.storage_location || '',
          item.expiry_date || '',
          item.lot || '', // LOT는 없을 수도 있음
          item.normal_quantity || 0 // 콤마 없이
        ].join('\t'); // 탭으로 구분
      });

      const clipboardText = rows.join('\n');

      // 클립보드에 복사
      await navigator.clipboard.writeText(clipboardText);

      setSuccess(true);
      alert(`입고전표 데이터가 클립보드에 복사되었습니다.\n총 ${editableData.length}개 항목\n\nERP에 붙여넣기(Ctrl+V) 하세요.`);
      setError('');
    } catch (err) {
      console.error('클립보드 복사 오류:', err);
      setError('클립보드 복사 중 오류가 발생했습니다: ' + err.message);
    }
  };

  // 입고전표 저장
  const saveWarehouseReceipt = async () => {
    if (!selectedRequest) {
      setError('선택된 요청이 없습니다.');
      return;
    }

    setProcessing(true);
    try {
      // 합계 수량 계산
      const totalEA = editableData.reduce((sum, item) => sum + (Number(item.normal_quantity) || 0), 0);

      // 1. warehouse_receipts 테이블에 저장
      const { data: receiptData, error: receiptError } = await supabase
        .from('warehouse_receipts')
        .insert([
          {
            erp_number: selectedRequest.request.erp_number,
            manager: selectedRequest.request.manager || null,
            from_location: selectedRequest.request.from_location,
            to_location: selectedRequest.request.to_location,
            total_ea: totalEA
          }
        ])
        .select();

      if (receiptError) {
        console.error('입고전표 저장 오류:', receiptError);
        throw receiptError;
      }

      const receiptId = receiptData[0].id;

      // 2. warehouse_receipt_details 테이블에 상세 데이터 저장
      const receiptDetails = editableData.map(item => ({
        receipt_id: receiptId,
        erp_seq_number: item.erp_seq_number,
        product_code: item.product_code,
        product_name: item.product_name,
        barcode: item.barcode,
        expiry_date: item.expiry_date,
        lot: item.lot,
        scheduled_quantity: item.scheduled_quantity,
        normal_quantity: item.normal_quantity,
        storage_location: item.storage_location || null
      }));

      const { error: detailsError } = await supabase
        .from('warehouse_receipt_details')
        .insert(receiptDetails);

      if (detailsError) {
        console.error('상세 데이터 저장 오류:', detailsError);
        throw detailsError;
      }

      setSuccess(true);
      setError('');
      setIsEditing(false);
      alert(`입고전표 저장 완료!\nERP 요청번호: ${selectedRequest.request.erp_number}\n총 ${receiptDetails.length}개 항목이 저장되었습니다.`);
    } catch (err) {
      console.error('Error saving warehouse receipt:', err);
      setError('입고전표 저장 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 엑셀 다운로드 (입력 탭용)
  const downloadExcel = async () => {
    if (!processedFiles.length) {
      setError('먼저 파일을 처리해주세요.');
      return;
    }

    if (!fromLocation || !toLocation) {
      setError('출발지와 도착지를 선택해주세요.');
      return;
    }

    setProcessing(true);
    try {
      // 합계 수량 계산
      const totalEA = calculateTotalQuantity(processedFiles);

      // 날짜 형식 변경 (yymmdd)
      const formattedDate = formatDateForFileNameYYMMDD(datePrefix);

      // 파렛트 수 계산
      const allDetailsData = processedFiles.flatMap(f => f.detailsData || []);
      const palletCount = calculatePalletCount(allDetailsData);

      // 파일명: 251123_프리즘창고_B동2층_재고이동_7842EA_3PLT (파렛트 수는 마지막)
      const fileName = `${formattedDate}_${fromLocation}_${toLocation}_재고이동_${totalEA}EA_${palletCount}PLT.xlsx`;

      await downloadMultiSheetExcel(processedFiles, fileName, datePrefix, clientName, palletCount);

      setSuccess(true);
    } catch (err) {
      console.error('Error exporting file:', err);
      setError('파일 내보내기 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  // 조회 결과로 엑셀 다운로드
  const downloadSearchResultsExcel = async () => {
    if (!selectedRequest) {
      setError('상세 내역을 먼저 조회해주세요.');
      return;
    }

    setProcessing(true);
    try {
      const { request, details } = selectedRequest;

      // 날짜 형식 변경 (yymmdd)
      const createdDate = new Date(request.created_at);
      const formattedDate = `${createdDate.getFullYear().toString().slice(-2)}${(createdDate.getMonth() + 1).toString().padStart(2, '0')}${createdDate.getDate().toString().padStart(2, '0')}`;

      // 파렛트 수 계산
      const palletCount = calculatePalletCount(details);

      // 파일명 (파렛트 수는 마지막)
      const fileName = `${formattedDate}_${request.from_location}_${request.to_location}_재고이동_${request.total_ea}EA_${palletCount}PLT.xlsx`;

      // ExcelJS로 엑셀 생성
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('재고이동');

      // 페이지 설정
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

      // 제목 행 (파렛트 수는 마지막)
      const titleRow = sheet.addRow([`${createdDate.getMonth() + 1}/${createdDate.getDate()} ${request.from_location} -> ${request.to_location} 재고이동 ${palletCount}PLT`]);
      titleRow.font = { size: 24, bold: true };
      titleRow.height = 40;
      sheet.mergeCells(1, 1, 1, 7);

      // 헤더 행
      const headerRow = sheet.addRow(['상품코드', '상품명', '유통기한', 'LOT', '다중로케이션', '정상수량', '적치 로케이션']);
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
      });

      // 데이터 행 (정상수량이 0인 행 제외)
      // 정렬: 상품코드 → 유통기한 → LOT (기존 정렬 유지)
      // 단, 같은 로케이션은 첫 번째 등장 위치 아래에 그룹핑
      let totalQuantity = 0;
      const filteredDetails = details
        .filter(detail => detail.normal_quantity && detail.normal_quantity !== 0 && detail.normal_quantity !== '0');

      // 1단계: 상품코드 → 유통기한 → LOT 순 정렬
      filteredDetails.sort((a, b) => {
        const codeA = (a.product_code || '').toString();
        const codeB = (b.product_code || '').toString();
        if (codeA !== codeB) return codeA.localeCompare(codeB);

        const expiryA = (a.expiry_date || '').toString();
        const expiryB = (b.expiry_date || '').toString();
        if (expiryA !== expiryB) return expiryA.localeCompare(expiryB);

        const lotA = (a.lot || '').toString();
        const lotB = (b.lot || '').toString();
        return lotA.localeCompare(lotB);
      });

      // 2단계: 같은 로케이션끼리 그룹핑 (첫 등장 위치 기준)
      const sortedDetails = [];
      const locationFirstIndex = new Map(); // 로케이션별 첫 등장 인덱스

      filteredDetails.forEach(detail => {
        const loc = (detail.normal_location || '').trim();
        if (!locationFirstIndex.has(loc)) {
          // 새 로케이션: 현재 위치에 추가
          locationFirstIndex.set(loc, sortedDetails.length);
          sortedDetails.push(detail);
        } else {
          // 기존 로케이션: 해당 그룹 마지막에 삽입
          const firstIdx = locationFirstIndex.get(loc);
          // 같은 로케이션 그룹의 마지막 위치 찾기
          let insertIdx = firstIdx + 1;
          while (insertIdx < sortedDetails.length &&
                 (sortedDetails[insertIdx].normal_location || '').trim() === loc) {
            insertIdx++;
          }
          sortedDetails.splice(insertIdx, 0, detail);
          // 이후 로케이션들의 인덱스 업데이트
          locationFirstIndex.forEach((idx, key) => {
            if (idx >= insertIdx && key !== loc) {
              locationFirstIndex.set(key, idx + 1);
            }
          });
        }
      });

      // 로케이션별 개수 계산 (2개 이상이면 하이라이트 대상)
      const locationCount = new Map();
      sortedDetails.forEach(detail => {
        const loc = (detail.normal_location || '').trim();
        locationCount.set(loc, (locationCount.get(loc) || 0) + 1);
      });

      const highlightColor = 'FFE3F2FD'; // 연한 파란색

      sortedDetails.forEach(detail => {
          const qty = Number(detail.normal_quantity) || 0;
          totalQuantity += qty;

          const currentLocation = (detail.normal_location || '').trim();
          // 같은 로케이션이 2개 이상이면 하이라이트
          const shouldHighlight = locationCount.get(currentLocation) >= 2;

          const dataRow = sheet.addRow([
            detail.product_code,
            detail.product_name,
            detail.expiry_date,
            detail.lot,
            detail.normal_location,
            Number(detail.normal_quantity) || 0,
            '' // 적치 로케이션 (빈 값)
          ]);

          dataRow.eachCell((cell, colNumber) => {
            cell.border = {
              top: { style: 'thin' },
              left: { style: 'thin' },
              bottom: { style: 'thin' },
              right: { style: 'thin' }
            };
            // 로케이션 열(5번)에만 하이라이트 적용 (같은 로케이션이 2개 이상일 때)
            if (colNumber === 5 && shouldHighlight) {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: highlightColor }
              };
            }
            // 정상수량 열(6번)에 천단위 콤마 포맷 적용
            if (colNumber === 6) {
              cell.numFmt = '#,##0';
              cell.alignment = { horizontal: 'right' };
            }
          });
        });

      // 합계 행 추가
      const totalRow = sheet.addRow([
        '',
        '',
        '',
        '',
        '합계',
        totalQuantity,
        ''
      ]);
      totalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF2CC' } // 연한 노란색 배경
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
        // 합계 수량 열(6번)에 천단위 콤마 포맷 적용
        if (colNumber === 6) {
          cell.numFmt = '#,##0';
          cell.alignment = { horizontal: 'right' };
        }
      });

      // 열 너비 조정
      sheet.getColumn(1).width = 18; // 상품코드
      sheet.getColumn(2).width = 65; // 상품명
      sheet.getColumn(3).width = 12; // 유통기한
      sheet.getColumn(4).width = 12; // LOT
      sheet.getColumn(5).width = 18; // 다중로케이션
      sheet.getColumn(6).width = 12; // 정상수량
      sheet.getColumn(7).width = 20; // 적치 로케이션

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading search results:', err);
      setError('엑셀 다운로드 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AuthLayout>
      <Head>
        <title>창고이동</title>
      </Head>
      <main className="min-h-screen bg-gray-50 px-4">
        <div className="max-w-6xl mx-auto bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-center text-gray-800 mb-2">
            창고이동 피킹지 생성
          </h1>
          <p className="text-center text-sm text-gray-500 mb-6">
            오늘 날짜: {new Date().toLocaleDateString()}
          </p>

          {/* 탭 메뉴 */}
          <div className="flex border-b border-gray-300 mb-6">
            <button
              onClick={() => setActiveTab('input')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'input'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-blue-600'
              }`}
            >
              입력
            </button>
            <button
              onClick={() => setActiveTab('search')}
              className={`px-6 py-3 font-medium transition-colors ${
                activeTab === 'search'
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-blue-600'
              }`}
            >
              조회
            </button>
          </div>

          {/* 입력 탭 */}
          {activeTab === 'input' && (
            <>
              {/* ERP 요청번호 및 담당자 입력 */}
              <div className="mb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">ERP 요청번호 *</label>
                  <input
                    type="text"
                    value={erpNumber}
                    onChange={(e) => setErpNumber(e.target.value)}
                    placeholder="WM-20251123-001"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">담당자 (선택)</label>
                  <input
                    type="text"
                    value={manager}
                    onChange={(e) => setManager(e.target.value)}
                    placeholder="홍길동"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* 출발지/도착지 선택 */}
              <div className="mb-4 p-3 bg-blue-50 rounded-md border border-blue-200">
                <h3 className="text-xs font-semibold text-blue-900 mb-2">재고이동 위치 선택</h3>

                {/* 출발지 선택 */}
                <div className="mb-3">
              <label className="block text-xs font-medium text-blue-900 mb-1.5">출발지</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => handleFromLocation('프리즘창고')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    fromLocation === '프리즘창고'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  프리즘창고
                </button>
                <button
                  type="button"
                  onClick={() => handleFromLocation('B동4층')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    fromLocation === 'B동4층'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  B동4층
                </button>
                <button
                  type="button"
                  onClick={() => handleFromLocation('B동2층')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    fromLocation === 'B동2층'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  B동2층
                </button>
                <button
                  type="button"
                  onClick={() => handleFromLocation('A동4층')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    fromLocation === 'A동4층'
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-blue-700 border border-blue-300 hover:bg-blue-100'
                  }`}
                >
                  A동4층
                </button>
              </div>
            </div>

            {/* 도착지 선택 */}
            <div>
              <label className="block text-xs font-medium text-blue-900 mb-1.5">도착지</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => handleToLocation('프리즘창고')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    toLocation === '프리즘창고'
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-green-700 border border-green-300 hover:bg-green-100'
                  }`}
                >
                  프리즘창고
                </button>
                <button
                  type="button"
                  onClick={() => handleToLocation('B동4층')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    toLocation === 'B동4층'
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-green-700 border border-green-300 hover:bg-green-100'
                  }`}
                >
                  B동4층
                </button>
                <button
                  type="button"
                  onClick={() => handleToLocation('B동2층')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    toLocation === 'B동2층'
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-green-700 border border-green-300 hover:bg-green-100'
                  }`}
                >
                  B동2층
                </button>
                <button
                  type="button"
                  onClick={() => handleToLocation('A동4층')}
                  className={`px-3 py-2 rounded-md transition-colors font-medium text-xs ${
                    toLocation === 'A동4층'
                      ? 'bg-green-600 text-white'
                      : 'bg-white text-green-700 border border-green-300 hover:bg-green-100'
                  }`}
                >
                  A동4층
                </button>
              </div>
            </div>

            {movementTitle && (
              <div className="mt-2 p-2 bg-white rounded border border-blue-300">
                <p className="text-xs text-gray-700">
                  <span className="font-semibold text-blue-900">선택:</span>
                  <span className="ml-2 font-medium">{movementTitle}</span>
                </p>
              </div>
            )}
          </div>

          <form onSubmit={processFiles} className="space-y-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">날짜</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={datePrefix}
                    onChange={(e) => setDatePrefix(e.target.value)}
                    placeholder="12/4"
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const today = new Date();
                      setDatePrefix(`${today.getMonth() + 1}/${today.getDate()}`);
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200"
                  >
                    오늘
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      setDatePrefix(`${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`);
                    }}
                    className="px-3 py-2 text-xs font-medium bg-gray-100 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-200"
                  >
                    내일
                  </button>
                </div>
              </div>
              <div className="flex-1">
                <label className="block text-xs font-medium text-gray-700 mb-1">엑셀 파일 업로드</label>
                <input
                  type="file"
                  onChange={handleFilesChange}
                  accept=".xls,.xlsx,.csv"
                  multiple
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="p-2 bg-red-100 text-red-700 rounded-md text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="p-2 bg-green-100 text-green-700 rounded-md text-sm">
                파일 처리가 완료되었습니다!
              </div>
            )}

            <button
              type="submit"
              disabled={processing}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 font-medium transition-colors text-sm"
            >
              {processing ? '처리 중...' : '파일 처리하기'}
            </button>
          </form>

          {/* 미리보기 테이블 */}
          {previewData && previewData.length > 0 && (
            <div className="mt-6">
              <h2 className="text-lg font-semibold mb-3">
                데이터 미리보기
                <span className="ml-3 text-sm font-normal text-blue-600">
                  총 {previewData.length}개 항목 / {calculatePalletCount(previewData)} PLT
                </span>
              </h2>
              <div className="overflow-x-auto border border-gray-300 rounded-md">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">ERP순번</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">상품코드</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">상품명</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">유통기한</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">LOT</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">예정수량</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">정상수량</th>
                      <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">로케이션</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {previewData.slice(0, 20).map((item, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-2 py-1.5 text-xs">{item.erpSeqNumber}</td>
                        <td className="px-2 py-1.5 text-xs">{item.productCode}</td>
                        <td className="px-2 py-1.5 text-xs max-w-xs truncate">{item.productName}</td>
                        <td className="px-2 py-1.5 text-xs">{item.expiryDate}</td>
                        <td className="px-2 py-1.5 text-xs">{item.lot}</td>
                        <td className="px-2 py-1.5 text-xs text-right">{item.scheduledQuantity}</td>
                        <td className="px-2 py-1.5 text-xs text-right">{item.normalQuantity}</td>
                        <td className="px-2 py-1.5 text-xs">{item.normalLocation}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {previewData.length > 20 && (
                <p className="mt-2 text-xs text-gray-600">총 {previewData.length}개 항목 중 20개만 표시</p>
              )}

              {/* 저장 및 다운로드 버튼 */}
              <div className="mt-4 flex gap-3">
                <button
                  onClick={saveToDatabase}
                  disabled={processing}
                  className="flex-1 bg-green-600 text-white py-2 px-4 rounded-md hover:bg-green-700 disabled:bg-gray-400 font-medium transition-colors text-sm"
                >
                  {processing ? '저장 중...' : 'DB에 저장'}
                </button>
                <button
                  onClick={downloadExcel}
                  disabled={processing}
                  className="flex-1 bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 disabled:bg-gray-400 font-medium transition-colors text-sm"
                >
                  {processing ? '생성 중...' : '엑셀 다운로드'}
                </button>
              </div>
            </div>
          )}

              <div className="mt-6 p-3 bg-blue-50 rounded-md">
                <h3 className="font-semibold text-blue-900 mb-2 text-sm">사용 방법</h3>
                <ol className="list-decimal list-inside space-y-1 text-xs text-blue-800">
                  <li>ERP 요청번호를 입력하세요</li>
                  <li>출발지와 도착지를 선택하세요</li>
                  <li>날짜를 입력하세요 (예: 11/23)</li>
                  <li>엑셀 파일을 업로드하고 &quot;파일 처리하기&quot; 클릭</li>
                  <li>데이터 미리보기 확인 후 &quot;DB에 저장&quot; 클릭</li>
                  <li>&quot;엑셀 다운로드&quot; 버튼으로 파일 다운로드</li>
                </ol>
              </div>
            </>
          )}

          {/* 조회 탭 */}
          {activeTab === 'search' && (
            <>
              {/* 필터 영역 */}
              <div className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
                <div className="flex flex-col md:flex-row gap-3">
                  {/* ERP 번호 검색 */}
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 mb-1">ERP 요청번호 검색</label>
                    <input
                      type="text"
                      value={searchErpNumber}
                      onChange={(e) => setSearchErpNumber(e.target.value)}
                      placeholder="WM-20251123-001"
                      className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* 상태 필터 */}
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">상태 필터</label>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setStatusFilter('all')}
                        className={`px-3 py-2 text-sm rounded-md transition-colors ${
                          statusFilter === 'all'
                            ? 'bg-blue-600 text-white'
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        전체
                      </button>
                      <button
                        onClick={() => setStatusFilter('대기중')}
                        className={`px-3 py-2 text-sm rounded-md transition-colors ${
                          statusFilter === '대기중'
                            ? 'bg-yellow-500 text-white'
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        대기중
                      </button>
                      <button
                        onClick={() => setStatusFilter('완료')}
                        className={`px-3 py-2 text-sm rounded-md transition-colors ${
                          statusFilter === '완료'
                            ? 'bg-green-600 text-white'
                            : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                        }`}
                      >
                        완료
                      </button>
                    </div>
                  </div>

                  {/* 새로고침 버튼 */}
                  <div className="flex items-end">
                    <button
                      onClick={loadAllRequests}
                      disabled={searching}
                      className="bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 disabled:bg-gray-400 font-medium transition-colors text-sm"
                    >
                      {searching ? '로딩...' : '새로고침'}
                    </button>
                  </div>
                </div>
              </div>

              {error && (
                <div className="p-2 bg-red-100 text-red-700 rounded-md mb-4 text-sm">
                  {error}
                </div>
              )}

              {/* 요청 리스트 */}
              {filteredRequests && filteredRequests.length > 0 && (
                <div className="mt-4">
                  <h2 className="text-base font-semibold mb-3">
                    ERP 요청 목록 ({filteredRequests.length}건)
                    {allRequests.length !== filteredRequests.length && (
                      <span className="text-gray-500 font-normal"> / 전체 {allRequests.length}건</span>
                    )}
                  </h2>
                  <div className="space-y-2 mb-4">
                    {filteredRequests.map((request) => (
                      <div
                        key={request.id}
                        className="p-3 border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => loadRequestDetails(request.id)}
                        onMouseDown={(e) => e.currentTarget.dataset.mouseDownTime = Date.now()}
                        onMouseUp={(e) => {
                          const mouseDownTime = parseInt(e.currentTarget.dataset.mouseDownTime || '0');
                          const elapsed = Date.now() - mouseDownTime;
                          // 200ms 이상 눌렀거나 텍스트 선택 중이면 클릭 방지
                          if (elapsed > 200 || window.getSelection()?.toString()) {
                            e.stopPropagation();
                          }
                        }}
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1 grid grid-cols-2 md:grid-cols-6 gap-3">
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="select-text cursor-text"
                            >
                              <p className="text-xs text-gray-600">ERP 요청번호</p>
                              <p className="font-medium text-xs">{request.erp_number}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-600">이동 경로</p>
                              <p className="font-medium text-xs">{request.from_location} → {request.to_location}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-600">총 수량</p>
                              <p className="font-medium text-sm">{request.total_ea} EA</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-600">상태</p>
                              <span className={`inline-block px-2 py-0.5 text-xs rounded-full font-medium ${
                                request.status === '완료'
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-yellow-100 text-yellow-800'
                              }`}>
                                {request.status || '대기중'}
                              </span>
                            </div>
                            <div>
                              <p className="text-xs text-gray-600">등록자</p>
                              <p className="font-medium text-xs">{request.created_by_email || '-'}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-600">생성일시</p>
                              <p className="font-medium text-xs">{new Date(request.created_at).toLocaleString('ko-KR')}</p>
                            </div>
                          </div>
                          <div className="ml-3 flex flex-col gap-1">
                            <button className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                              상세보기
                            </button>
                            <button
                              onClick={(e) => toggleStatus(request.id, request.status, e)}
                              disabled={processing}
                              className={`px-2 py-1 text-xs rounded disabled:opacity-50 ${
                                request.status === '완료'
                                  ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                                  : 'bg-green-100 text-green-700 hover:bg-green-200'
                              }`}
                            >
                              {request.status === '완료' ? '대기중으로' : '완료처리'}
                            </button>
                            <button
                              onClick={(e) => deleteRequest(request.id, e)}
                              disabled={processing}
                              className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 리스트가 비어있을 때 */}
              {!searching && filteredRequests.length === 0 && allRequests.length > 0 && (
                <div className="text-center py-8 text-gray-500">
                  검색 조건에 맞는 요청이 없습니다.
                </div>
              )}

              {!searching && allRequests.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  등록된 요청이 없습니다.
                </div>
              )}

              {/* 선택된 요청의 상세 내역 */}
              {selectedRequest && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-300 rounded-md">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-base font-semibold">상세 내역</h3>
                    <button
                      onClick={() => setSelectedRequest(null)}
                      className="px-3 py-1 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                    >
                      접기 ▲
                    </button>
                  </div>

                  {/* 요청 정보 */}
                  <div className="mb-3 p-2 bg-white rounded border">
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-gray-600">담당자</p>
                        <p className="font-medium text-xs">{selectedRequest.request.manager || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">이동 경로</p>
                        <p className="font-medium text-xs">{selectedRequest.request.from_location} → {selectedRequest.request.to_location}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">총 수량</p>
                        <p className="font-medium text-xs">{Number(selectedRequest.request.total_ea).toLocaleString()} EA</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">총 파레트 수</p>
                        <p className="font-medium text-xs">{new Set(selectedRequest.details.map(d => d.normal_location).filter(Boolean)).size} PLT</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-600">생성일시</p>
                        <p className="font-medium text-xs">{new Date(selectedRequest.request.created_at).toLocaleString('ko-KR')}</p>
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={downloadSearchResultsExcel}
                          disabled={processing}
                          className="w-full bg-purple-600 text-white py-1 px-2 rounded hover:bg-purple-700 disabled:bg-gray-400 text-xs transition-colors"
                        >
                          {processing ? '생성 중...' : '엑셀 다운로드'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 반출전표 (읽기 전용) */}
                  <div className="mb-3">
                    <h4 className="text-sm font-semibold mb-2 text-blue-900">반출전표 (원본)</h4>
                    <div className="overflow-x-auto border border-gray-300 rounded-md bg-white">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-100">
                          <tr>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">ERP순번</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">상품코드</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">상품명</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">유통기한</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">LOT</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">예정수량</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">정상수량</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">로케이션</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {selectedRequest.details.map((item, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-2 py-1.5 text-xs">{item.erp_seq_number}</td>
                              <td className="px-2 py-1.5 text-xs">{item.product_code}</td>
                              <td className="px-2 py-1.5 text-xs max-w-xs truncate">{item.product_name}</td>
                              <td className="px-2 py-1.5 text-xs">{item.expiry_date}</td>
                              <td className="px-2 py-1.5 text-xs">{item.lot}</td>
                              <td className="px-2 py-1.5 text-xs text-right">{item.scheduled_quantity}</td>
                              <td className="px-2 py-1.5 text-xs text-right">{item.normal_quantity}</td>
                              <td className="px-2 py-1.5 text-xs">{item.normal_location}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 입고전표 (편집 가능) */}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="text-sm font-semibold text-green-900">입고전표 (편집 가능)</h4>
                      <div className="flex gap-2">
                        {!isEditing ? (
                          <>
                            <button
                              onClick={copyReceiptToClipboard}
                              className="bg-purple-600 text-white py-1 px-3 rounded hover:bg-purple-700 text-xs"
                            >
                              📋 클립보드 복사
                            </button>
                            <button
                              onClick={startEditing}
                              className="bg-blue-600 text-white py-1 px-3 rounded hover:bg-blue-700 text-xs"
                            >
                              입고 작업 시작
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={cancelEditing}
                              className="bg-gray-500 text-white py-1 px-3 rounded hover:bg-gray-600 text-xs"
                            >
                              취소
                            </button>
                            <button
                              onClick={validateQuantities}
                              className="bg-orange-600 text-white py-1 px-3 rounded hover:bg-orange-700 text-xs"
                            >
                              수량 검증
                            </button>
                            <button
                              onClick={copyReceiptToClipboard}
                              className="bg-purple-600 text-white py-1 px-3 rounded hover:bg-purple-700 text-xs"
                            >
                              📋 클립보드 복사
                            </button>
                            <button
                              onClick={saveWarehouseReceipt}
                              disabled={processing}
                              className="bg-green-600 text-white py-1 px-3 rounded hover:bg-green-700 disabled:bg-gray-400 text-xs"
                            >
                              {processing ? '저장 중...' : '입고전표 저장'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* 수량 불일치 경고 */}
                    {quantityMismatches.length > 0 && (
                      <div className="mb-2 p-2 bg-red-100 border border-red-300 rounded-md">
                        <p className="text-xs font-semibold text-red-800 mb-1">⚠️ 수량 불일치 발견</p>
                        <div className="space-y-1">
                          {quantityMismatches.map((mismatch, index) => (
                            <p key={index} className="text-xs text-red-700">
                              <strong>{mismatch.productCode}</strong> ({mismatch.productName}):
                              예정 <strong>{mismatch.scheduledTotal}</strong> ≠ 정상 <strong>{mismatch.normalTotal}</strong>
                              {mismatch.difference > 0 && <span className="text-red-900"> (+{mismatch.difference})</span>}
                              {mismatch.difference < 0 && <span className="text-red-900"> ({mismatch.difference})</span>}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="overflow-x-auto border border-gray-300 rounded-md bg-white">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-green-100">
                          <tr>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">ERP순번</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">상품코드</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">상품명</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">유통기한</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">LOT</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">예정수량</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700">정상수량</th>
                            <th className="px-2 py-1.5 text-left text-xs font-medium text-gray-700 bg-yellow-100">적치로케이션</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {editableData.map((item, index) => (
                            <tr key={index} className="hover:bg-gray-50">
                              <td className="px-2 py-1.5 text-xs">{item.erp_seq_number}</td>
                              <td className="px-2 py-1.5 text-xs">{item.product_code}</td>
                              <td className="px-2 py-1.5 text-xs max-w-xs truncate">{item.product_name}</td>
                              <td className="px-2 py-1.5 text-xs">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={item.expiry_date || ''}
                                    onChange={(e) => handleCellChange(index, 'expiry_date', e.target.value)}
                                    className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                ) : (
                                  item.expiry_date
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs">
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={item.lot || ''}
                                    onChange={(e) => handleCellChange(index, 'lot', e.target.value)}
                                    className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                ) : (
                                  item.lot
                                )}
                              </td>
                              <td className="px-2 py-1.5 text-xs text-right">{item.scheduled_quantity}</td>
                              <td className="px-2 py-1.5 text-xs text-right">
                                {isEditing ? (
                                  <input
                                    type="number"
                                    value={item.normal_quantity || ''}
                                    onChange={(e) => handleCellChange(index, 'normal_quantity', e.target.value)}
                                    className="w-full px-1 py-0.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-right"
                                  />
                                ) : (
                                  item.normal_quantity
                                )}
                              </td>
                              <td className={`px-2 py-1.5 text-xs ${
                                item.storage_location && duplicateLocations.has(item.storage_location.trim())
                                  ? 'bg-red-200'
                                  : 'bg-yellow-50'
                              }`}>
                                {isEditing ? (
                                  <input
                                    type="text"
                                    value={item.storage_location || ''}
                                    onChange={(e) => handleCellChange(index, 'storage_location', e.target.value)}
                                    placeholder="A-01-01-01"
                                    className={`w-full px-1 py-0.5 text-xs border rounded focus:outline-none focus:ring-1 ${
                                      item.storage_location && duplicateLocations.has(item.storage_location.trim())
                                        ? 'border-red-500 focus:ring-red-500 bg-red-100'
                                        : 'border-yellow-400 focus:ring-yellow-500 bg-yellow-50'
                                    }`}
                                  />
                                ) : (
                                  item.storage_location || '-'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </AuthLayout>
  );
}
