import React, { useState, useCallback, useMemo, useRef } from 'react';
import Head from 'next/head';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.min.css';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import AuthLayout from '@/components/AuthLayout';

registerAllModules();

// 유틸리티 함수: 값 정규화 (null, undefined, 빈 문자열을 빈 문자열로 통일)
const normalizeValue = (value) => {
  if (value === null || value === undefined || value === 'undefined' || value === 'null') {
    return '';
  }
  return String(value).trim();
};

// 유틸리티 함수: 고유 키 생성 (상품코드 포함 - 같은 로케이션에 여러 상품 가능)
const createUniqueKey = (productCode, warehouse, location, lot, expDate) => {
  const normalizedProductCode = normalizeValue(productCode);
  const normalizedWarehouse = normalizeValue(warehouse);
  const normalizedLocation = normalizeValue(location);
  const normalizedLot = normalizeValue(lot);
  const normalizedExpDate = normalizeValue(expDate);
  return `${normalizedProductCode}|${normalizedWarehouse}|${normalizedLocation}|${normalizedLot}|${normalizedExpDate}`;
};

// 유틸리티 함수: 키 파싱
const parseUniqueKey = (key) => {
  const parts = key.split('|');
  return {
    productCode: parts[0] || '',
    warehouse: parts[1] || '',
    location: parts[2] || '',
    lot: parts[3] || '',
    expDate: parts[4] || ''
  };
};

const LocationModal = ({ orderItem, locations, originalStockData, pickingHistory, previousPicks = {}, onClose, onSave }) => {
  const hotTableRef = useRef(null);
  const [isSaving, setIsSaving] = useState(false); // 저장 중 플래그 추가
  const [modalPickingList, setModalPickingList] = useState(
    locations.map(loc => {
      const productCode = normalizeValue(loc['상품코드']);
      const warehouse = normalizeValue(loc['창고']);
      const location = normalizeValue(loc['다중로케이션']);
      const lot = normalizeValue(loc['LOT']);
      const expDate = normalizeValue(loc['유통기한']);
      const key = createUniqueKey(productCode, warehouse, location, lot, expDate);

      // 원본 재고에서 시작
      const originalStock = parseInt(originalStockData[key] || 0, 10);

      // 모든 주문의 피킹 수량 합산 (현재 주문 제외)
      let totalPickedFromThisLocation = 0;
      Object.entries(pickingHistory).forEach(([orderId, picks]) => {
        if (parseInt(orderId, 10) !== orderItem.orderId) {
          totalPickedFromThisLocation += parseInt(picks[key] || 0, 10);
        }
      });

      // 현재 가용 재고 = 원본 재고 - 다른 주문들의 피킹 수량
      const availableStock = originalStock - totalPickedFromThisLocation;

      return {
        창고: warehouse,
        productCode: normalizeValue(loc['상품코드']),
        productName: normalizeValue(loc['상품명']),
        바코드: normalizeValue(loc['바코드']),
        유통기한: expDate,
        LOT: lot,
        location: location,
        availableStock: availableStock,
        pickingQuantity: parseInt(previousPicks[key] || 0, 10),
        uniqueId: key
      };
    })
  );

  const totalPickingQuantity = useMemo(() => 
    modalPickingList.reduce((sum, item) => sum + (parseInt(item.pickingQuantity, 10) || 0), 0),
    [modalPickingList]
  );

  const remainingQuantity = useMemo(() => 
    parseInt(orderItem.requestedQuantity, 10) - totalPickingQuantity,
    [orderItem.requestedQuantity, totalPickingQuantity]
  );

  const handleAfterChange = (changes, source) => {
    if (!changes) return;

    const hot = hotTableRef.current?.hotInstance;
    if (!hot) return;

    // 현재 정렬 상태 저장
    const sortPlugin = hot.getPlugin('columnSorting');
    const currentSortConfig = sortPlugin.getSortConfig();

    setModalPickingList(prevList => {
      const updatedList = [...prevList];

      changes.forEach(([row, prop, oldValue, newValue]) => {
        if (prop === 'pickingQuantity') {
          const value = parseInt(newValue, 10) || 0;

          // 정렬을 고려하여 실제 데이터 행 찾기
          const physicalRow = hot.toPhysicalRow(row);
          const currentItem = updatedList[physicalRow];

          if (!currentItem) return;

          const maxAvailable = parseInt(currentItem.availableStock, 10);

          // 실시간으로 현재 상태 기준 총합 계산 (변경 중인 행 제외)
          const currentTotalPicked = updatedList.reduce((sum, item, idx) =>
            idx !== physicalRow ? sum + (parseInt(item.pickingQuantity, 10) || 0) : sum, 0
          );

          const remaining = parseInt(orderItem.requestedQuantity, 10) - currentTotalPicked;

          if (value > maxAvailable) {
            alert(`재고 부족: 현재 가용 재고량은 ${maxAvailable}개입니다.`);
            updatedList[physicalRow].pickingQuantity = Math.min(maxAvailable, remaining);
          } else if (value > remaining) {
            const currentTotal = updatedList.reduce((sum, item, idx) =>
              idx !== physicalRow ? sum + (parseInt(item.pickingQuantity, 10) || 0) : sum, 0);
            const wouldBeTotal = currentTotal + value;
            alert(
              `배정 초과:\n` +
              `• 요청수량: ${orderItem.requestedQuantity.toLocaleString()}개\n` +
              `• 다른 로케이션 배정: ${currentTotal.toLocaleString()}개\n` +
              `• 현재 입력: ${value.toLocaleString()}개\n` +
              `• 합계: ${wouldBeTotal.toLocaleString()}개 (${(wouldBeTotal - orderItem.requestedQuantity).toLocaleString()}개 초과)\n\n` +
              `최대 ${remaining.toLocaleString()}개까지만 배정 가능합니다.`
            );
            updatedList[physicalRow].pickingQuantity = remaining;
          } else {
            updatedList[physicalRow].pickingQuantity = value;
          }
        }
      });

      // 정렬 상태 복원 (상태 업데이트 후)
      if (currentSortConfig && currentSortConfig.length > 0) {
        setTimeout(() => {
          sortPlugin.sort(currentSortConfig);
        }, 0);
      }

      return updatedList;
    });
  };

  const handleFillAll = (uniqueId) => {
    const hot = hotTableRef.current?.hotInstance;
    if (!hot) return;

    const rowIndex = modalPickingList.findIndex(item => item.uniqueId === uniqueId);
    if (rowIndex === -1) return;

    const currentItem = modalPickingList[rowIndex];
    const maxAvailable = parseInt(currentItem.availableStock, 10) || 0;

    const currentTotalPicked = modalPickingList.reduce((sum, item, idx) =>
      idx !== rowIndex ? sum + (parseInt(item.pickingQuantity, 10) || 0) : sum, 0
    );

    const remaining = parseInt(orderItem.requestedQuantity, 10) - currentTotalPicked;
    const fillQuantity = Math.min(maxAvailable, remaining);

    if (fillQuantity <= 0) {
      alert('배정 가능한 수량이 없습니다.');
      return;
    }

    // 현재 정렬 상태 저장
    const sortPlugin = hot.getPlugin('columnSorting');
    const currentSortConfig = sortPlugin.getSortConfig();

    // Handsontable에서 해당 셀만 업데이트 (setDataAtCell -> afterChange -> setModalPickingList 순서로 상태 업데이트)
    const visualRow = hot.toVisualRow(rowIndex);
    const pickingColIndex = hot.propToCol('pickingQuantity');
    hot.setDataAtCell(visualRow, pickingColIndex, fillQuantity, 'fillAll');

    // 정렬 상태 복원
    if (currentSortConfig && currentSortConfig.length > 0) {
      setTimeout(() => {
        sortPlugin.sort(currentSortConfig);
      }, 0);
    }
  };

  const handleResetAll = () => {
    if (!window.confirm('모든 피킹수량을 초기화하시겠습니까?')) {
      return;
    }

    const hot = hotTableRef.current?.hotInstance;

    // 현재 정렬 상태 저장
    let currentSortConfig = null;
    if (hot) {
      const sortPlugin = hot.getPlugin('columnSorting');
      currentSortConfig = sortPlugin.getSortConfig();
    }

    const updatedList = modalPickingList.map(item => ({
      ...item,
      pickingQuantity: 0
    }));
    setModalPickingList(updatedList);

    // 정렬 상태 복원
    if (hot && currentSortConfig && currentSortConfig.length > 0) {
      setTimeout(() => {
        const sortPlugin = hot.getPlugin('columnSorting');
        sortPlugin.sort(currentSortConfig);
      }, 0);
    }
  };

  const handleClearRow = (uniqueId) => {
    const hot = hotTableRef.current?.hotInstance;
    if (!hot) return;

    const rowIndex = modalPickingList.findIndex(item => item.uniqueId === uniqueId);
    if (rowIndex === -1) return;

    // 현재 정렬 상태 저장
    const sortPlugin = hot.getPlugin('columnSorting');
    const currentSortConfig = sortPlugin.getSortConfig();

    // Handsontable에서 해당 셀만 업데이트
    const visualRow = hot.toVisualRow(rowIndex);
    const pickingColIndex = hot.propToCol('pickingQuantity');
    hot.setDataAtCell(visualRow, pickingColIndex, 0, 'clearRow');

    // 정렬 상태 복원
    if (currentSortConfig && currentSortConfig.length > 0) {
      setTimeout(() => {
        sortPlugin.sort(currentSortConfig);
      }, 0);
    }
  };

  const handleSave = () => {
    if (isSaving) return; // 중복 클릭 방지
    
    // 최종 검증: 총 피킹수량 체크
    const totalPicked = modalPickingList.reduce((sum, item) => 
      sum + (parseInt(item.pickingQuantity, 10) || 0), 0
    );
    
    const requestedQty = parseInt(orderItem.requestedQuantity, 10);
    
    if (totalPicked > requestedQty) {
      alert(
        `⚠️ 수량 초과 오류\n\n` +
        `요청수량: ${requestedQty.toLocaleString()}개\n` +
        `배정수량: ${totalPicked.toLocaleString()}개\n` +
        `초과수량: ${(totalPicked - requestedQty).toLocaleString()}개\n\n` +
        `시스템 오류로 저장이 차단되었습니다.\n` +
        `관리자에게 문의해주세요.`
      );
      return;
    }
    
    // 재고 초과 검증 (피킹수량이 있는 행만 검증)
    const stockErrors = [];
    modalPickingList.forEach(item => {
      const picked = parseInt(item.pickingQuantity, 10) || 0;
      const available = parseInt(item.availableStock, 10) || 0;
      // 피킹수량이 0보다 큰 경우만 검증
      if (picked > 0 && picked > available) {
        stockErrors.push(
          `${item.location} (LOT: ${item.LOT}): 배정 ${picked}개 > 재고 ${available}개`
        );
      }
    });
    
    if (stockErrors.length > 0) {
      alert(
        `⚠️ 재고 초과 오류\n\n` +
        stockErrors.join('\n') +
        `\n\n시스템 오류로 저장이 차단되었습니다.\n` +
        `관리자에게 문의해주세요.`
      );
      return;
    }
    
    setIsSaving(true);
    try {
      onSave(modalPickingList);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[9999]">
      <div className="bg-white rounded-lg shadow-xl flex flex-col w-full max-w-7xl h-[90vh] relative z-[10000]">
        {/* 헤더 */}
        <div className="p-6 border-b flex-shrink-0">
          <div className="flex justify-between items-start mb-4">
            <h2 className="text-xl font-bold">
              로케이션 선택 - {orderItem.productCode} / {orderItem.productName} (주문번호: {orderItem.orderId})
              {orderItem.minExpiryDate && (
                <span className="ml-2 text-sm font-normal text-orange-600 bg-orange-100 px-2 py-1 rounded">
                  유통기한 {orderItem.minExpiryDate} 이상
                </span>
              )}
            </h2>
            <button
              onClick={handleResetAll}
              className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg font-medium transition-colors"
            >
              전체 초기화
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-blue-50 p-4 rounded-lg text-center">
              <div className="text-sm text-gray-600 mb-1">요청수량</div>
              <div className="text-2xl font-bold text-blue-600">
                {orderItem.requestedQuantity.toLocaleString()}
              </div>
            </div>
            <div className="bg-green-50 p-4 rounded-lg text-center">
              <div className="text-sm text-gray-600 mb-1">피킹수량</div>
              <div className="text-2xl font-bold text-green-600">
                {totalPickingQuantity.toLocaleString()}
              </div>
            </div>
            <div className="bg-red-50 p-4 rounded-lg text-center">
              <div className="text-sm text-gray-600 mb-1">남은수량</div>
              <div className="text-2xl font-bold text-red-600">
                {remainingQuantity.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* 테이블 영역 - 스크롤 가능 */}
        <div className="flex-1 overflow-auto p-4">
          <HotTable
            ref={hotTableRef}
            data={modalPickingList}
            columns={[
              { data: '창고', title: '창고', readOnly: true, width: 80 },
              { data: 'productName', title: '상품명', readOnly: true, width: 350 },
              { 
                data: '유통기한', 
                title: '유통기한', 
                readOnly: true, 
                width: 100
              },
              { 
                data: 'LOT', 
                title: 'LOT', 
                readOnly: true, 
                width: 100
              },
              { 
                data: 'location', 
                title: '로케이션', 
                readOnly: true, 
                width: 120
              },
              { 
                data: 'availableStock', 
                title: '가용재고', 
                readOnly: true,
                width: 100,
                renderer: (instance, td, row, col, prop, value) => {
                  td.innerHTML = value ? value.toLocaleString() : '0';
                  td.className = 'text-right';
                  return td;
                }
              },
              { 
                data: 'pickingQuantity', 
                title: '피킹수량',
                width: 100,
                renderer: (instance, td, row, col, prop, value) => {
                  td.innerHTML = value ? value.toLocaleString() : '0';
                  td.className = 'text-right';
                  return td;
                }
              },
              {
                data: null,
                title: '전체배정',
                readOnly: true,
                width: 80,
                renderer: (instance, td, row, col, prop, value) => {
                  td.innerHTML = '';
                  
                  // 정렬을 고려한 실제 데이터 행 가져오기
                  const visualRow = row;
                  const physicalRow = instance.toPhysicalRow(visualRow);
                  const rowData = modalPickingList[physicalRow];
                  
                  if (!rowData) return td;
                  
                  const button = document.createElement('button');
                  button.textContent = '전체';
                  button.className = 'px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-sm rounded font-medium transition-colors';
                  button.onclick = (e) => {
                    e.stopPropagation();
                    handleFillAll(rowData.uniqueId);
                  };
                  td.appendChild(button);
                  td.className = 'text-center';
                  return td;
                }
              },
              {
                data: null,
                title: '초기화',
                readOnly: true,
                width: 80,
                renderer: (instance, td, row, col, prop, value) => {
                  td.innerHTML = '';
                  
                  // 정렬을 고려한 실제 데이터 행 가져오기
                  const visualRow = row;
                  const physicalRow = instance.toPhysicalRow(visualRow);
                  const rowData = modalPickingList[physicalRow];
                  
                  if (!rowData) return td;
                  
                  const button = document.createElement('button');
                  button.textContent = '초기화';
                  button.className = 'px-3 py-1 bg-gray-500 hover:bg-gray-600 text-white text-sm rounded font-medium transition-colors';
                  button.onclick = (e) => {
                    e.stopPropagation();
                    handleClearRow(rowData.uniqueId);
                  };
                  td.appendChild(button);
                  td.className = 'text-center';
                  return td;
                }
              }
            ]}
            afterChange={handleAfterChange}
            licenseKey="non-commercial-and-evaluation"
            colHeaders={true}
            rowHeaders={true}
            columnSorting={{
              indicator: true,
              headerAction: true,
              sortEmptyCells: true,
              initialConfig: {
                column: 2,
                sortOrder: 'asc'
              }
            }}
            height="auto"
            stretchH="all"
          />
        </div>

        {/* 버튼 영역 */}
        <div className="p-4 border-t flex justify-end gap-2 flex-shrink-0 bg-gray-50">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              isSaving 
                ? 'bg-gray-400 cursor-not-allowed text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            }`}
          >
            {isSaving ? '저장 중...' : '저장'}
          </button>
          <button 
            onClick={onClose}
            disabled={isSaving}
            className="px-6 py-2 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-300 text-white rounded-lg font-medium transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
};

export default function PickingList() {
  const [excelData, setExcelData] = useState(new Map());
  const [pickingList, setPickingList] = useState([]);
  const [orderInput, setOrderInput] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [modalLocations, setModalLocations] = useState([]);
  const [pickingHistory, setPickingHistory] = useState({});
  const [originalStockData, setOriginalStockData] = useState({}); // 원본 재고 데이터 (불변)
  const [realStockData, setRealStockData] = useState({}); // 현재 가용 재고 (동적 변경)
  const [dateInput, setDateInput] = useState(''); // 날짜 입력 필드
  const [clientNameInput, setClientNameInput] = useState(''); // 업체명 입력 필드

  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { range: 1 });

      const dataMap = new Map();
      const initialStock = {};

      jsonData.forEach(item => {
        const code = normalizeValue(item['상품코드']);
        if (!code) return;

        const warehouse = normalizeValue(item['창고']);
        const location = normalizeValue(item['다중로케이션']);
        const lot = normalizeValue(item['LOT']);
        const expDate = normalizeValue(item['유통기한']);
        const stock = parseInt(String(item['가용재고'] || '0').replace(/,/g, ''), 10) || 0;

        // 고유 키 생성 (상품코드 포함 - 같은 로케이션에 여러 상품 가능)
        const uniqueKey = createUniqueKey(code, warehouse, location, lot, expDate);

        if (!dataMap.has(code)) {
          dataMap.set(code, []);
        }

        // 원본 데이터를 그대로 저장 (필드명 변경 없음)
        dataMap.get(code).push({
          '창고': warehouse,
          '상품코드': code,
          '상품명': normalizeValue(item['상품명']),
          '바코드': normalizeValue(item['바코드']),
          '다중로케이션': location,
          'LOT': lot,
          '유통기한': expDate,
          '가용재고': stock
        });

        initialStock[uniqueKey] = stock;
      });

      setExcelData(dataMap);
      setOriginalStockData(initialStock); // 원본 재고 저장
      setRealStockData(initialStock); // 현재 가용 재고 초기화
      setPickingList([]);
      setPickingHistory({});
      alert(`엑셀 파일 업로드 완료: ${dataMap.size}개 상품 로드됨`);
    };

    reader.readAsArrayBuffer(file);
  };

  const processOrderInput = () => {
    if (excelData.size === 0) {
      alert('엑셀 파일을 먼저 업로드해주세요.');
      return;
    }

    if (!orderInput.trim()) {
      alert('주문 정보를 입력해주세요.');
      return;
    }

    // 기존 피킹리스트가 있으면 경고
    if (pickingList.length > 0) {
      const totalPicked = pickingList.reduce((sum, item) => sum + parseInt(item.pickedQuantity, 10), 0);
      
      if (totalPicked > 0) {
        if (!window.confirm(
          `⚠️ 경고: 기존에 작업 중인 피킹리스트가 있습니다!\n\n` +
          `현재 피킹 완료된 수량: ${totalPicked.toLocaleString()}개\n\n` +
          `계속 진행하면 모든 작업 내역이 삭제됩니다.\n` +
          `정말로 새로운 피킹리스트를 생성하시겠습니까?`
        )) {
          return;
        }
      } else {
        if (!window.confirm(
          `기존 피킹리스트를 삭제하고 새로 생성하시겠습니까?`
        )) {
          return;
        }
      }
    }
     
    const lines = orderInput.split('\n').filter(line => line.trim());
    const newPickingList = [];
    let orderCounter = 1;
    const shortageItems = [];
    const notFoundItems = [];
    
    lines.forEach(line => {
      // 상품코드 수량 유통기한(선택) 형식 파싱
      // 예: ABCD 100 2025-01-01 또는 ABCD 100
      const matches = line.match(/([A-Z0-9-]+)\s*(?:,\s*)?(\d+(?:,\d{3})*|\d+)(?:\s+(\d{4}-\d{2}-\d{2}))?/);
      if (!matches) return;

      const [, productCode, quantityStr, minExpiryDate] = matches;
      const quantity = parseInt(quantityStr.replace(/,/g, ''), 10);
      const code = normalizeValue(productCode);
      const locations = excelData.get(code);

      if (!locations) {
        // 엑셀에 없는 상품도 피킹리스트에 추가 (추후 입고될 상품일 수 있음)
        notFoundItems.push({
          code: productCode,
          required: quantity
        });
        newPickingList.push({
          orderId: orderCounter++,
          productCode: code,
          productName: '(미등록 상품)',
          requestedQuantity: quantity,
          pickedQuantity: 0,
          minExpiryDate: minExpiryDate || null
        });
        return;
      }

      const productInfo = locations[0];

      // 유통기한 필터가 있으면 해당 기한 이상인 재고만 계산
      const filteredLocations = minExpiryDate
        ? locations.filter(loc => {
            const expiry = loc['유통기한'];
            if (!expiry) return false;
            // 날짜 비교 (문자열 비교로 YYYY-MM-DD 형식 비교 가능)
            return String(expiry) >= minExpiryDate;
          })
        : locations;

      const totalStock = filteredLocations.reduce((sum, loc) =>
        sum + parseInt(loc['가용재고'] || 0, 10), 0
      );

      if (totalStock < quantity) {
        shortageItems.push({
          code: productCode,
          name: productInfo['상품명'],
          required: quantity,
          available: totalStock,
          minExpiryDate: minExpiryDate || null
        });
      }

      newPickingList.push({
        orderId: orderCounter++,
        productCode: code,
        productName: productInfo['상품명'],
        requestedQuantity: quantity,
        pickedQuantity: 0,
        minExpiryDate: minExpiryDate || null
      });
    });

    if (notFoundItems.length > 0) {
      const message = notFoundItems.map(item => 
        `- ${item.code}: 요청수량 ${item.required.toLocaleString()}개`
      ).join('\n');
      alert('엑셀에 없는 상품 목록:\n' + message);
    }
    
    if (shortageItems.length > 0) {
      const message = shortageItems.map(item => 
        `- ${item.name} (${item.code}): 요청 ${item.required.toLocaleString()}개 / 재고 ${item.available.toLocaleString()}개`
      ).join('\n');
      alert('재고 부족 상품 목록:\n' + message);
    }
     
    setPickingList(newPickingList);
    setPickingHistory({});
  };

  const handleExcelDownload = async () => {
    if (pickingList.length === 0) {
      alert('다운로드할 피킹리스트가 없습니다.');
      return;
    }

    // 날짜와 업체명 확인
    if (!dateInput.trim()) {
      alert('날짜를 입력해주세요. (예: 251112)');
      return;
    }
    if (!clientNameInput.trim()) {
      alert('업체명을 입력해주세요.');
      return;
    }

    const totalRequested = pickingList.reduce((sum, item) => sum + parseInt(item.requestedQuantity, 10), 0);
    const totalPicked = pickingList.reduce((sum, item) => sum + parseInt(item.pickedQuantity, 10), 0);
     
    if (totalRequested !== totalPicked) {
      if (!window.confirm(
        `피킹수량이 일치하지 않습니다.\n` +
        `요청수량: ${totalRequested.toLocaleString()}\n` +
        `피킹수량: ${totalPicked.toLocaleString()}\n\n` +
        `다운로드 하시겠습니까?`
      )) {
        return;
      }
    }
    
    const displayList = generateDisplayList();

    // 정렬하지 않고 원본 순서 유지
    const sortedDisplayList = displayList;

    // 사용자가 입력한 날짜와 업체명 사용
    const datePrefix = dateInput.trim();
    const clientName = clientNameInput.trim();
    
    // 날짜를 m/d 형식으로 변환 (거래명세서용)
    let datePrefixForStatement = datePrefix;
    if (datePrefix.length === 6) {
      // yymmdd → m/d
      const month = parseInt(datePrefix.substring(2, 4), 10);
      const day = parseInt(datePrefix.substring(4, 6), 10);
      datePrefixForStatement = `${month}/${day}`;
    }
    
    // 첫 번째 행에 표시할 제목
    const titleText = `${datePrefixForStatement} ${clientName}`;
    
    // ExcelJS 워크북 생성
    const workbook = new ExcelJS.Workbook();
    workbook.creator = '피킹리스트 관리';
    workbook.created = new Date();
    
    // 피킹수량 0인 항목도 포함 (미등록 상품 등 추후 입고될 상품)
    const filteredDisplayList = sortedDisplayList;
    
    // 시트1: 피킹리스트
    const sheet1 = workbook.addWorksheet('피킹리스트');
    
    // A4 가로 방향 페이지 설정
    sheet1.pageSetup = {
      paperSize: 9, // A4
      orientation: 'landscape', // 가로
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3
      }
    };
    
    const titleRow1 = sheet1.addRow([titleText]);
    titleRow1.font = { size: 14, bold: true };
    titleRow1.height = 25;
    
    const headerRow1 = sheet1.addRow(['창고', '상품코드', '상품명', '유통기한', 'LOT', '로케이션', '예정수량', '정상수량']);
    headerRow1.font = { bold: true };
    headerRow1.alignment = { vertical: 'middle', horizontal: 'center' };

    // 헤더 행 스타일 (A~H열만)
    for (let i = 1; i <= 8; i++) {
      const cell = headerRow1.getCell(i);
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
    }
    
    sortedDisplayList.forEach(item => {
      const dataRow = sheet1.addRow([
        item.창고 || '',
        item.productCode || '',
        item.productName || '',
        item.유통기한 || '',
        item.LOT || '',
        item.location || '',
        item.requestedQuantity || 0,
        item.pickedQuantity || 0
      ]);

      // 테두리 추가 (A~H열만)
      for (let i = 1; i <= 8; i++) {
        const cell = dataRow.getCell(i);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    });
    
    const totalRow1 = sheet1.addRow(['합계', '', '', '', '', '', totalRequested, totalPicked]);
    totalRow1.font = { bold: true };

    // 합계 행 스타일 (A~H열만)
    for (let i = 1; i <= 8; i++) {
      const cell = totalRow1.getCell(i);
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
    }
    
    // 시트1 열 너비 자동 조절
    sheet1.columns.forEach((column, index) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: false }, cell => {
        const cellValue = cell.value ? cell.value.toString() : '';
        const cellLength = cellValue.length;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      // 최소 너비 10, 최대 너비 80, 여백 +2
      column.width = Math.min(Math.max(maxLength + 2, 10), 80);
    });
    
    // 시트2: B2B입출고대기
    const sheet2 = workbook.addWorksheet('B2B입출고대기');
    
    // A4 가로 방향 페이지 설정
    sheet2.pageSetup = {
      paperSize: 9, // A4
      orientation: 'landscape', // 가로
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3
      }
    };
    
    // 제목 행 제거 - 바로 헤더부터 시작
    const headerRow2 = sheet2.addRow(['바코드', '반출로케이션', '반입로케이션', '유통기한', 'LOT', '이동수량']);
    headerRow2.font = { bold: true };
    headerRow2.alignment = { vertical: 'middle', horizontal: 'center' };

    // 헤더 행 스타일 (A~F열만)
    for (let i = 1; i <= 6; i++) {
      const cell = headerRow2.getCell(i);
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
    }
    
    let totalTransfer = 0;
    filteredDisplayList.forEach(item => {
      const dataRow = sheet2.addRow([
        item.바코드 || '',
        item.location || '',
        item.location || '',
        item.유통기한 || '',
        item.LOT || '',
        item.pickedQuantity || 0
      ]);
      totalTransfer += item.pickedQuantity || 0;

      // 테두리 추가 (A~F열만)
      for (let i = 1; i <= 6; i++) {
        const cell = dataRow.getCell(i);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    });
    
    const totalRow2 = sheet2.addRow(['합계', '', '', '', '', totalTransfer]);
    totalRow2.font = { bold: true };

    // 합계 행 스타일 (A~F열만)
    for (let i = 1; i <= 6; i++) {
      const cell = totalRow2.getCell(i);
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
    }
    
    // 시트2 열 너비 자동 조절
    sheet2.columns.forEach((column, index) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: false }, cell => {
        const cellValue = cell.value ? cell.value.toString() : '';
        const cellLength = cellValue.length;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 80);
    });
    
    // 시트3: 패킹리스트
    const sheet3 = workbook.addWorksheet('패킹리스트');
    
    // A4 가로 방향 페이지 설정
    sheet3.pageSetup = {
      paperSize: 9, // A4
      orientation: 'landscape', // 가로
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.75,
        bottom: 0.75,
        header: 0.3,
        footer: 0.3
      }
    };
    
    const packingTitle = sheet3.addRow([`${titleText} 패킹리스트`]);
    packingTitle.font = { size: 16, bold: true }; // 크기 증가
    packingTitle.height = 30;
    
    const headerRow3 = sheet3.addRow(['PLT NO', '상품코드', '상품명', 'EA/BOX', '아웃박스수량(BOX)', '환산수량(곽)', '박스 당 중량(KG)', '제조번호', '유통기한']);
    headerRow3.font = { bold: true };
    headerRow3.alignment = { vertical: 'middle', horizontal: 'center' };

    // 헤더 행 스타일 (A~I열만)
    for (let i = 1; i <= 9; i++) {
      const cell = headerRow3.getCell(i);
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
    }
    
    let totalPacking = 0;
    filteredDisplayList.forEach(item => {
      const dataRow = sheet3.addRow([
        '',
        item.productCode || '',
        item.productName || '',
        '',
        '',
        item.pickedQuantity || 0,
        '',
        item.LOT || '',
        item.유통기한 || ''
      ]);
      totalPacking += item.pickedQuantity || 0;

      // 테두리 추가 (A~I열만)
      for (let i = 1; i <= 9; i++) {
        const cell = dataRow.getCell(i);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      }
    });
    
    const totalRow3 = sheet3.addRow(['', '', '합계', '', '', totalPacking, '', '', '']);
    totalRow3.font = { bold: true };

    // 합계 행 스타일 (A~I열만)
    for (let i = 1; i <= 9; i++) {
      const cell = totalRow3.getCell(i);
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
    }
    
    // 시트3 열 너비 자동 조절
    sheet3.columns.forEach((column, index) => {
      let maxLength = 0;
      column.eachCell({ includeEmpty: false }, cell => {
        const cellValue = cell.value ? cell.value.toString() : '';
        const cellLength = cellValue.length;
        if (cellLength > maxLength) {
          maxLength = cellLength;
        }
      });
      column.width = Math.min(Math.max(maxLength + 2, 10), 80);
    });
    
    // 시트4: 거래명세서 (ExcelJS로 완벽하게 구현)
    await createTransactionStatementSheetExcelJS(workbook, filteredDisplayList, datePrefixForStatement, clientName);
    
    // 파일명: yymmdd_업체명_선패킹.xlsx
    const filename = `${datePrefix}_${clientName}_선패킹.xlsx`;
    
    // 파일 다운로드
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // 거래명세서 시트 생성 함수 (ExcelJS)
  const createTransactionStatementSheetExcelJS = async (workbook, displayList, datePrefix, clientName) => {
    const transactionSheet = workbook.addWorksheet('거래명세서');
    
    // A4 세로 방향 페이지 설정
    transactionSheet.pageSetup = {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    };
    
    // 날짜 포맷 변환 (m/d → 2025-mm-dd)
    let formattedFullDate = '2025-01-01';
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

    // 제품별로 수량 합계 계산 (상품코드 + 상품명 기준으로 통합)
    const productMap = {};
    displayList.forEach(item => {
      const key = `${item.productCode}_${item.productName}`;
      if (!productMap[key]) {
        productMap[key] = {
          productCode: item.productCode,
          productName: item.productName,
          barcode: item.바코드,
          quantity: 0
        };
      }
      productMap[key].quantity += parseInt(item.pickedQuantity, 10) || 0;
    });

    const products = Object.values(productMap);
    const totalQuantity = products.reduce((sum, p) => sum + p.quantity, 0);

    // 스타일 헬퍼 함수
    const styleHeaderCell = (cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.font = { name: 'Arial', bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    };

    const styleDataCell = (cell) => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
      cell.font = { name: 'Arial' };
      cell.alignment = { vertical: 'middle' };
    };

    const styleTotalCell = (cell) => {
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
      cell.font = { name: 'Arial', bold: true }; // ✅ bold 추가
    };

    // 제목 행
    const titleRow = transactionSheet.addRow(['거 래 명 세 서']);
    titleRow.font = { name: 'Gulim', size: 20, bold: true };
    titleRow.height = 35;
    transactionSheet.mergeCells('A1:D1');
    titleRow.alignment = { horizontal: 'center', vertical: 'middle' };
    
    // 빈 행
    transactionSheet.addRow([]);
    
    // 거래처 정보 테이블
    const clientRow = transactionSheet.addRow(['거 래 처', clientName || '', '담 당 자', '']);
    clientRow.height = 25;
    styleHeaderCell(clientRow.getCell(1));
    styleHeaderCell(clientRow.getCell(3));
    styleDataCell(clientRow.getCell(2));
    styleDataCell(clientRow.getCell(4));
    
    const dateRow = transactionSheet.addRow(['일 자', formattedFullDate, '담당연락처', '']);
    dateRow.height = 25;
    styleHeaderCell(dateRow.getCell(1));
    styleHeaderCell(dateRow.getCell(3));
    styleDataCell(dateRow.getCell(2));
    styleDataCell(dateRow.getCell(4));
    
    const settlementRow = transactionSheet.addRow(['정산 일자', formattedFullDate, '주 소', '']);
    settlementRow.height = 25;
    styleHeaderCell(settlementRow.getCell(1));
    styleHeaderCell(settlementRow.getCell(3));
    styleDataCell(settlementRow.getCell(2));
    styleDataCell(settlementRow.getCell(4));
    
    const typeRow = transactionSheet.addRow(['구 분', '반출 (일반)', '참고 사항', '']);
    typeRow.height = 25;
    styleHeaderCell(typeRow.getCell(1));
    styleHeaderCell(typeRow.getCell(3));
    styleDataCell(typeRow.getCell(2));
    styleDataCell(typeRow.getCell(4));
    
    const voucherRow = transactionSheet.addRow(['전표 번호', '', '', '']);
    voucherRow.height = 25;
    styleHeaderCell(voucherRow.getCell(1));
    transactionSheet.mergeCells(`B${voucherRow.number}:D${voucherRow.number}`);
    styleDataCell(voucherRow.getCell(2));
    
    const memoRow = transactionSheet.addRow(['입고 메모', '', '', '']);
    memoRow.height = 35;
    styleHeaderCell(memoRow.getCell(1));
    transactionSheet.mergeCells(`B${memoRow.number}:D${memoRow.number}`);
    styleDataCell(memoRow.getCell(2));
    
    const boxRow = transactionSheet.addRow(['박스 번호', '', '', '']);
    boxRow.height = 25;
    styleHeaderCell(boxRow.getCell(1));
    transactionSheet.mergeCells(`B${boxRow.number}:D${boxRow.number}`);
    styleDataCell(boxRow.getCell(2));
    
    // 빈 행
    transactionSheet.addRow([]);
    
    // 상품 목록 테이블 헤더
    const itemsHeaderRow = transactionSheet.addRow(['상품코드', '상품명', '바코드', '합계 수량']);
    itemsHeaderRow.height = 25;
    itemsHeaderRow.eachCell((cell) => {
      styleHeaderCell(cell);
    });
    
    // 상품 데이터 행
    products.forEach(product => {
      const itemRow = transactionSheet.addRow([
        product.productCode,
        product.productName,
        product.barcode,
        product.quantity
      ]);
      
      const codeCell = itemRow.getCell(1);
      codeCell.alignment = { horizontal: 'center', vertical: 'middle' };
      styleDataCell(codeCell);
      
      const nameCell = itemRow.getCell(2);
      nameCell.alignment = { horizontal: 'left', vertical: 'middle' };
      styleDataCell(nameCell);
      
      const barcodeCell = itemRow.getCell(3);
      barcodeCell.alignment = { horizontal: 'center', vertical: 'middle' };
      styleDataCell(barcodeCell);
      
      const quantityCell = itemRow.getCell(4);
      quantityCell.alignment = { horizontal: 'right', vertical: 'middle' };
      quantityCell.font = { bold: true };
      quantityCell.numFmt = '#,##0';
      styleDataCell(quantityCell);
    });
    
    // 합계 행
    const totalRow = transactionSheet.addRow(['', '합계', '', totalQuantity]);
    
    const emptyCell1 = totalRow.getCell(1);
    emptyCell1.alignment = { horizontal: 'center', vertical: 'middle' };
    styleTotalCell(emptyCell1);
    
    const totalLabelCell = totalRow.getCell(2);
    totalLabelCell.alignment = { horizontal: 'left', vertical: 'middle' };
    totalLabelCell.font = { bold: true, size: 12, name: 'Arial' }; // 크기만 추가
    styleTotalCell(totalLabelCell);
    
    const emptyCell2 = totalRow.getCell(3);
    emptyCell2.alignment = { horizontal: 'center', vertical: 'middle' };
    styleTotalCell(emptyCell2);
    
    const totalValueCell = totalRow.getCell(4);
    totalValueCell.alignment = { horizontal: 'right', vertical: 'middle' };
    totalValueCell.font = { bold: true, size: 12, name: 'Arial' }; // 크기만 추가
    totalValueCell.numFmt = '#,##0';
    styleTotalCell(totalValueCell);
    
    // 열 너비 조정
    transactionSheet.getColumn('A').width = 15;
    transactionSheet.getColumn('B').width = 45;
    transactionSheet.getColumn('C').width = 15;
    transactionSheet.getColumn('D').width = 25;
  };

  const generateDisplayList = useCallback(() => {
    const displayList = [];
    
    pickingList.forEach(item => {
      const picks = pickingHistory[item.orderId] || {};
      const locations = Object.entries(picks);

      if (locations.length === 0) {
        displayList.push({
          ...item,
          창고: '',
          바코드: '',
          유통기한: '',
          LOT: '',
          location: '',
          pickedQuantity: 0,
        });
      } else {
        locations.forEach(([key, qty], index) => {
          // 키 파싱 (상품코드 포함)
          const { productCode, warehouse, location, lot, expDate } = parseUniqueKey(key);

          const productData = excelData.get(item.productCode);

          // 매칭: 원본 필드명 사용 (상품코드, 창고 포함)
          const locationData = productData?.find(d =>
            normalizeValue(d['상품코드']) === productCode &&
            normalizeValue(d['창고']) === warehouse &&
            normalizeValue(d['다중로케이션']) === location &&
            normalizeValue(d['LOT']) === lot &&
            normalizeValue(d['유통기한']) === expDate
          );

          if (locationData) {
            displayList.push({
              ...item,
              창고: locationData['창고'] || '',
              바코드: locationData['바코드'] || '',
              유통기한: expDate,
              LOT: lot,
              location: location,
              pickedQuantity: parseInt(qty, 10),
              requestedQuantity: index === 0 ? parseInt(item.requestedQuantity, 10) : null
            });
          } else {
            // 매칭 실패 시 경고 (디버깅용)
            console.warn('매칭 실패:', { productCode: item.productCode, key, warehouse, location, lot, expDate });
            displayList.push({
              ...item,
              창고: warehouse || '매칭오류',
              바코드: '',
              유통기한: expDate,
              LOT: lot,
              location: location,
              pickedQuantity: parseInt(qty, 10),
              requestedQuantity: index === 0 ? parseInt(item.requestedQuantity, 10) : null
            });
          }
        });
      }
    });
    
    return displayList;
  }, [pickingList, pickingHistory, excelData]);
  
  const handleCellClick = (event, coords, td) => {
    if (coords.row < 0 || coords.col !== 9) return;
    
    const displayData = generateDisplayList();
    const currentRow = displayData[coords.row];
    
    if (!currentRow.orderId) return;
    
    const order = pickingList.find(item => item.orderId === currentRow.orderId);
    let locations = excelData.get(order.productCode);

    // 유통기한 필터가 있으면 해당 기한 이상인 로케이션만 표시
    if (locations && order.minExpiryDate) {
      locations = locations.filter(loc => {
        const expiry = loc['유통기한'];
        if (!expiry) return false;
        return String(expiry) >= order.minExpiryDate;
      });
    }

    if (locations && locations.length > 0) {
      setSelectedOrder(order);
      setModalLocations(locations);
    }
  };

  const handleModalSave = (updatedLocations) => {
    if (!selectedOrder) return;

    const oldPicks = pickingHistory[selectedOrder.orderId] || {};
    const newPicks = {};
    const newRealStock = { ...realStockData };

    // 이전 피킹 수량 복구
    Object.entries(oldPicks).forEach(([key, quantity]) => {
      const prevQuantity = parseInt(quantity, 10) || 0;
      newRealStock[key] = (parseInt(newRealStock[key], 10) || 0) + prevQuantity;
    });

    // 새 피킹 수량 적용
    updatedLocations.forEach(loc => {
      const pickQuantity = parseInt(loc.pickingQuantity, 10) || 0;
      if (pickQuantity > 0) {
        const key = createUniqueKey(loc.productCode, loc.창고, loc.location, loc.LOT, loc.유통기한);
        newPicks[key] = pickQuantity;
        newRealStock[key] = Math.max(0, (parseInt(newRealStock[key], 10) || 0) - pickQuantity);
      }
    });

    setPickingHistory(prev => ({
      ...prev,
      [selectedOrder.orderId]: newPicks
    }));

    const totalPicked = Object.values(newPicks).reduce((sum, qty) => sum + parseInt(qty, 10), 0);
    setPickingList(prevList =>
      prevList.map(item =>
        item.orderId === selectedOrder.orderId
          ? { ...item, pickedQuantity: totalPicked }
          : item
      )
    );

    setRealStockData(newRealStock);
    setSelectedOrder(null);
  };
  
  return (
    <AuthLayout>
      <Head>
        <title>선패킹</title>
      </Head>
    <div className="p-6 max-w-full relative z-[1]">
      <h1 className="text-2xl font-bold mb-6">피킹리스트 관리</h1>

      {/* 엑셀 업로드 */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <label className="block mb-2 font-medium">1. 재고 엑셀 파일 업로드</label>
        <input
          type="file"
          accept=".xlsx,.xls"
          onChange={handleExcelUpload}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
        />
        {excelData.size > 0 && (
          <p className="mt-2 text-sm text-green-600">
            ✓ {excelData.size}개 상품이 로드되었습니다.
          </p>
        )}
      </div>

      {/* 주문 입력 */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <label className="block mb-2 font-medium">2. 날짜 및 업체명 입력</label>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1">날짜 (yymmdd 형식)</label>
            <input
              type="text"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              placeholder="예: 251112"
              className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">업체명</label>
            <input
              type="text"
              value={clientNameInput}
              onChange={(e) => setClientNameInput(e.target.value)}
              placeholder="예: ABC마트"
              className="w-full p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        
        <label className="block mb-2 font-medium">3. 주문 정보 입력 (상품코드 수량)</label>
        <textarea
          value={orderInput}
          onChange={(e) => setOrderInput(e.target.value)}
          placeholder="예시:&#10;ABC-123 100&#10;DEF-456 50&#10;GHI-789 200"
          className="w-full h-32 p-3 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-2 mt-3">
          <button
            onClick={processOrderInput}
            disabled={excelData.size === 0}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            피킹리스트 생성
          </button>
          <button
            onClick={handleExcelDownload}
            disabled={pickingList.length === 0}
            className="px-6 py-2 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors"
          >
            엑셀 다운로드
          </button>
        </div>
      </div>

      {/* 피킹리스트 테이블 */}
      {pickingList.length > 0 && (
        <div className="bg-white rounded-lg shadow relative z-[1]">
          <div className="p-4 border-b">
            <h2 className="text-lg font-bold">4. 피킹리스트 (피킹수량 클릭하여 배정)</h2>
          </div>
          <div className="p-4">
            <HotTable
              data={generateDisplayList()}
              columns={[
                { data: 'orderId', title: '주문번호', readOnly: true, width: 80 },
                { data: '창고', title: '창고', readOnly: true, width: 80 },
                { data: 'productCode', title: '상품코드', readOnly: true, width: 130 },
                { data: 'productName', title: '상품명', readOnly: true, width: 400 },
                { data: '바코드', title: '바코드', readOnly: true, width: 150 },
                { data: '유통기한', title: '유통기한', readOnly: true, width: 100 },
                { data: 'LOT', title: 'LOT', readOnly: true, width: 100 },
                { data: 'location', title: '로케이션', readOnly: true, width: 120 },
                { 
                  data: 'requestedQuantity', 
                  title: '요청수량', 
                  readOnly: true,
                  width: 100,
                  renderer: (instance, td, row, col, prop, value) => {
                    td.innerHTML = value ? value.toLocaleString() : '';
                    td.className = 'text-right';
                    return td;
                  }
                },
                { 
                  data: 'pickedQuantity', 
                  title: '피킹수량', 
                  readOnly: true,
                  width: 100,
                  className: 'cursor-pointer bg-blue-50',
                  renderer: (instance, td, row, col, prop, value) => {
                    td.innerHTML = value ? value.toLocaleString() : '<span class="text-gray-400">클릭</span>';
                    td.className = 'text-right cursor-pointer font-bold';
                    return td;
                  }
                }
              ]}
              licenseKey="non-commercial-and-evaluation"
              colHeaders={true}
              rowHeaders={true}
              columnSorting={{
                indicator: true,
                headerAction: true,
                sortEmptyCells: true
              }}
              afterOnCellMouseDown={handleCellClick}
              height="auto"
              stretchH="all"
            />
          </div>
        </div>
      )}

      {/* 로케이션 선택 모달 */}
      {selectedOrder && (
        <LocationModal
          orderItem={selectedOrder}
          locations={modalLocations}
          originalStockData={originalStockData}
          pickingHistory={pickingHistory}
          previousPicks={pickingHistory[selectedOrder.orderId] || {}}
          onClose={() => setSelectedOrder(null)}
          onSave={handleModalSave}
        />
      )}
    </div>
    </AuthLayout>
  );
}