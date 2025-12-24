import React, { useState, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import Handsontable from 'handsontable';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.min.css';
import { Upload, Copy, Plus } from 'lucide-react';

registerAllModules();

// 컬럼 인덱스 상수
// 0: 상품코드, 1: 상품명, 2: ERP요청순번, 3: 바코드, 4: 예정수량, 5: 남은수량
// 6: 로케이션, 7: 유통기한, 8: LOT, 9: 수량
const COL = {
  PRODUCT_CODE: 0,
  PRODUCT_NAME: 1,
  ERP_REQUEST_NO: 2,
  BARCODE: 3,
  EXPECTED_QTY: 4,
  REMAINING_QTY: 5,
  LOCATION: 6,
  EXPIRY_DATE: 7,
  LOT: 8,
  QUANTITY: 9
};

// 편집 가능한 컬럼 목록 (Tab 이동용)
const EDITABLE_COLS = [COL.LOCATION, COL.EXPIRY_DATE, COL.LOT, COL.QUANTITY];

const LocationAssignmentApp = () => {
  const [excelData, setExcelData] = useState([]);
  const [tableData, setTableData] = useState([]);
  const fileInputRef = useRef(null);
  const hotRef = useRef(null);

  // 엑셀 파일 읽기
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];

      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      // 2행을 헤더로 사용 (인덱스 1)
      const headers = jsonData[1];
      const dataRows = jsonData.slice(2);

      // 필요한 컬럼 인덱스 찾기
      const columnIndexes = {
        productCode: headers.findIndex(h => h && h.toString().includes('상품코드')),
        productName: headers.findIndex(h => h && h.toString().includes('상품명')),
        erpRequestNo: headers.findIndex(h => h && h.toString().includes('ERP요청순번')),
        barcode: headers.findIndex(h => h && h.toString().includes('바코드')),
        quantity: headers.findIndex(h => h && h.toString().includes('예정수량'))
      };

      // 데이터 파싱
      const parsedData = dataRows
        .filter(row => row[columnIndexes.productCode])
        .map((row, index) => ({
          id: index + 1,
          productCode: row[columnIndexes.productCode] || '',
          productName: row[columnIndexes.productName] || '',
          erpRequestNo: row[columnIndexes.erpRequestNo] || '',
          barcode: row[columnIndexes.barcode] || '',
          quantity: parseInt(row[columnIndexes.quantity]) || 0
        }));

      setExcelData(parsedData);

      // Handsontable용 데이터 생성
      // 순서: 상품코드, 상품명, ERP요청번호, 바코드, 예정수량, 남은수량, 로케이션, 유통기한, LOT, 수량
      const initialTableData = parsedData.map(item => [
        item.productCode,    // 0: 상품코드
        item.productName,    // 1: 상품명
        item.erpRequestNo,   // 2: ERP요청번호
        item.barcode,        // 3: 바코드
        item.quantity,       // 4: 예정수량
        item.quantity,       // 5: 남은수량 (초기값 = 예정수량)
        '',                  // 6: 로케이션
        '',                  // 7: 유통기한
        '',                  // 8: LOT
        ''                   // 9: 수량
      ]);

      setTableData(initialTableData);

    } catch (error) {
      console.error('파일 읽기 오류:', error);
      alert('엑셀 파일을 읽는 중 오류가 발생했습니다.');
    }
  };

  // 로케이션 포맷팅 (실시간 적용: 2자리마다 - 추가)
  // 8자리 초과 시 포맷팅하지 않고 원본 유지 (오류 표시용)
  const formatLocation = (value) => {
    if (!value) return '';
    const cleaned = value.toString().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

    // 8자리 초과면 포맷팅하지 않고 원본 반환 (오류로 표시됨)
    if (cleaned.length > 8) {
      return cleaned; // 빨간색으로 표시될 예정
    }

    // 2자리씩 나눠서 - 로 연결
    const parts = [];
    for (let i = 0; i < cleaned.length; i += 2) {
      parts.push(cleaned.slice(i, i + 2));
    }
    return parts.join('-');
  };

  // 로케이션 유효성 검사 (XX-XX-XX-XX 형식, 총 8자리)
  const isValidLocation = (value) => {
    if (!value) return true; // 빈 값은 허용
    const cleaned = value.toString().replace(/[^a-zA-Z0-9]/g, '');
    return cleaned.length <= 8;
  };

  // 유통기한 포맷팅
  const formatExpiryDate = (value) => {
    if (!value) return '';
    const cleaned = value.toString().replace(/[^0-9]/g, '');
    if (cleaned.length === 8) {
      return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
    }
    return value;
  };

  // 남은수량 재계산 (상품코드 + ERP요청번호 조합 기준)
  const recalculateRemaining = (data) => {
    // 상품코드+ERP요청번호별 배정수량 합계 계산
    const assignedByKey = {};
    data.forEach(row => {
      const key = `${row[COL.PRODUCT_CODE]}_${row[COL.ERP_REQUEST_NO]}`;
      const assignedQty = parseInt(row[COL.QUANTITY]) || 0;
      if (key) {
        assignedByKey[key] = (assignedByKey[key] || 0) + assignedQty;
      }
    });

    // 남은수량 업데이트
    return data.map(row => {
      const key = `${row[COL.PRODUCT_CODE]}_${row[COL.ERP_REQUEST_NO]}`;
      const product = excelData.find(p =>
        p.productCode === row[COL.PRODUCT_CODE] &&
        p.erpRequestNo === row[COL.ERP_REQUEST_NO]
      );
      if (product) {
        const assigned = assignedByKey[key] || 0;
        row[COL.REMAINING_QTY] = product.quantity - assigned;
      }
      return row;
    });
  };

  // 행 추가
  const addRow = () => {
    if (tableData.length === 0) return;

    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    const selected = hot.getSelected();
    let insertIndex = tableData.length;
    let sourceRow = tableData[tableData.length - 1];

    if (selected && selected.length > 0) {
      const selectedRow = selected[0][0];
      insertIndex = selectedRow + 1;
      sourceRow = tableData[selectedRow];
    }

    // 선택된 행의 상품 정보로 새 행 생성
    const newRow = [
      sourceRow[COL.PRODUCT_CODE],    // 상품코드
      sourceRow[COL.PRODUCT_NAME],    // 상품명
      sourceRow[COL.ERP_REQUEST_NO],  // ERP요청번호
      sourceRow[COL.BARCODE],         // 바코드
      sourceRow[COL.EXPECTED_QTY],    // 예정수량
      sourceRow[COL.REMAINING_QTY],   // 남은수량
      '',                              // 로케이션
      '',                              // 유통기한
      '',                              // LOT
      ''                               // 수량
    ];

    const newData = [...tableData];
    newData.splice(insertIndex, 0, newRow);
    setTableData(recalculateRemaining(newData));
  };

  // 클립보드 복사용 데이터 생성
  // 순서: 바코드, ERP요청번호, 정상다중로케이션, 유통기한, LOT, 정상수량
  const generateClipboardData = () => {
    const validRows = tableData.filter(row => row[COL.LOCATION] && row[COL.QUANTITY]); // 로케이션과 수량이 있는 행

    if (validRows.length === 0) {
      alert('복사할 데이터가 없습니다. 로케이션과 수량을 입력해주세요.');
      return '';
    }

    // 잘못된 로케이션 체크
    const invalidRows = validRows.filter(row => !isValidLocation(row[COL.LOCATION]));
    if (invalidRows.length > 0) {
      const invalidLocs = invalidRows.map(row => row[COL.LOCATION]).join(', ');
      alert(`잘못된 로케이션이 있습니다 (8자리 초과):\n${invalidLocs}\n\n수정 후 다시 시도해주세요.`);
      return '';
    }

    const clipboardRows = validRows.map(row => [
      row[COL.BARCODE],              // 바코드
      row[COL.ERP_REQUEST_NO] || '', // ERP요청번호
      row[COL.LOCATION],             // 정상다중로케이션
      row[COL.EXPIRY_DATE] || '',    // 유통기한
      row[COL.LOT] || '',            // LOT (빈값도 정상)
      row[COL.QUANTITY]              // 정상수량
    ].join('\t'));

    return clipboardRows.join('\n');
  };

  // 클립보드 복사
  const copyToClipboard = () => {
    const data = generateClipboardData();
    if (!data) return;

    navigator.clipboard.writeText(data).then(() => {
      alert('클립보드에 복사되었습니다.');
    }).catch(err => {
      console.error('복사 실패:', err);
      alert('복사에 실패했습니다.');
    });
  };

  // Handsontable 컬럼 설정
  const columns = [
    { data: COL.PRODUCT_CODE, title: '상품코드', width: 57, readOnly: true },
    { data: COL.PRODUCT_NAME, title: '상품명', width: 180, readOnly: true },
    { data: COL.ERP_REQUEST_NO, title: '순번', width: 35, readOnly: true, className: 'htCenter' },
    { data: COL.BARCODE, title: '바코드', width: 70, readOnly: true, className: 'htCenter' },
    { data: COL.EXPECTED_QTY, title: '예정', width: 50, readOnly: true, type: 'numeric', className: 'htCenter' },
    { data: COL.REMAINING_QTY, title: '남은', width: 50, readOnly: true, type: 'numeric', className: 'htCenter' },
    { data: COL.LOCATION, title: '로케이션', width: 85, className: 'htCenter' },
    { data: COL.EXPIRY_DATE, title: '유통기한', width: 80, className: 'htCenter' },
    { data: COL.LOT, title: 'LOT', width: 65, className: 'htCenter' },
    { data: COL.QUANTITY, title: '수량', width: 45, type: 'numeric', className: 'htCenter' }
  ];

  // 중복 로케이션 찾기
  const getDuplicateLocations = () => {
    const locationCount = {};
    tableData.forEach(row => {
      const loc = row[COL.LOCATION];
      if (loc && loc.trim()) {
        locationCount[loc] = (locationCount[loc] || 0) + 1;
      }
    });
    // 2번 이상 나타나는 로케이션만 반환
    return Object.keys(locationCount).filter(loc => locationCount[loc] > 1);
  };

  const duplicateLocations = getDuplicateLocations();

  // 셀 스타일링
  function cellRenderer(instance, td, row, col, prop, value, cellProperties) {
    // 기본 렌더러 호출
    if (cellProperties.type === 'numeric') {
      Handsontable.renderers.NumericRenderer.apply(this, arguments);
    } else {
      Handsontable.renderers.TextRenderer.apply(this, arguments);
    }

    // 남은수량 컬럼 스타일링
    if (col === COL.REMAINING_QTY) {
      const remaining = parseInt(value) || 0;
      if (remaining > 0) {
        td.style.color = '#dc2626';
        td.style.fontWeight = 'bold';
      } else {
        td.style.color = '#16a34a';
        td.style.fontWeight = 'bold';
      }
    }

    // 로케이션 오류 체크 (8자리 초과)
    if (col === COL.LOCATION && value && !isValidLocation(value)) {
      td.style.backgroundColor = '#fecaca'; // 빨간색 배경
      td.style.color = '#dc2626';
      td.style.fontWeight = 'bold';
      td.title = '로케이션은 8자리(XX-XX-XX-XX)여야 합니다';
    }
    // 로케이션 중복 하이라이트
    else if (col === COL.LOCATION && value && duplicateLocations.includes(value)) {
      td.style.backgroundColor = '#fef08a'; // 노란색 하이라이트
      td.style.fontWeight = 'bold';
    }

    // 읽기 전용 컬럼 배경색
    if (col <= COL.REMAINING_QTY) {
      td.style.backgroundColor = '#f9fafb';
    }
  }

  // afterChange 핸들러
  const handleAfterChange = (changes, source) => {
    if (!changes || source === 'loadData') return;

    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    let needsUpdate = false;
    const newData = [...tableData];

    changes.forEach(([row, prop, oldValue, newValue]) => {
      const col = typeof prop === 'number' ? prop : parseInt(prop);

      // 로케이션 포맷팅
      if (col === COL.LOCATION && newValue !== oldValue) {
        const formatted = formatLocation(newValue);
        if (formatted !== newValue) {
          newData[row][COL.LOCATION] = formatted;
          needsUpdate = true;
        }
      }

      // 유통기한 포맷팅
      if (col === COL.EXPIRY_DATE && newValue !== oldValue) {
        const formatted = formatExpiryDate(newValue);
        if (formatted !== newValue) {
          newData[row][COL.EXPIRY_DATE] = formatted;
          needsUpdate = true;
        }
      }

      // 수량 변경 시 남은수량 재계산
      if (col === COL.QUANTITY) {
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      setTableData(recalculateRemaining(newData));
    }
  };

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl+Enter: 행 추가
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        addRow();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [tableData, excelData]);

  // 배정 요약 계산 (상품코드 + ERP요청번호 기준)
  const getSummary = () => {
    const summary = {};
    excelData.forEach(product => {
      const key = `${product.productCode}_${product.erpRequestNo}`;
      summary[key] = {
        productCode: product.productCode,
        erpRequestNo: product.erpRequestNo,
        total: product.quantity,
        assigned: 0
      };
    });

    tableData.forEach(row => {
      const key = `${row[COL.PRODUCT_CODE]}_${row[COL.ERP_REQUEST_NO]}`;
      if (summary[key]) {
        summary[key].assigned += parseInt(row[COL.QUANTITY]) || 0;
      }
    });

    return Object.values(summary);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-full mx-auto">
        <h1 className="text-3xl font-bold text-gray-800 mb-8">입고 로케이션 배정</h1>

        {/* 파일 업로드 */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-2">엑셀 파일 업로드</h2>
              <p className="text-gray-600 text-sm">2행이 헤더인 엑셀 파일을 업로드하세요.</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
              >
                <Upload size={20} />
                파일 선택
              </button>
              {tableData.length > 0 && (
                <>
                  <button
                    onClick={addRow}
                    className="flex items-center gap-2 bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors"
                    title="Ctrl+Enter"
                  >
                    <Plus size={20} />
                    행 추가
                  </button>
                  <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                  >
                    <Copy size={20} />
                    클립보드 복사
                  </button>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Handsontable */}
        {tableData.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="mb-4 flex justify-between items-center">
              <h2 className="text-xl font-semibold">로케이션 배정 작업</h2>
              <span className="text-sm text-gray-500">
                Ctrl+Enter: 행 추가 | 엑셀처럼 편집 가능
              </span>
            </div>

            <HotTable
              ref={hotRef}
              data={tableData}
              columns={columns}
              colHeaders={true}
              rowHeaders={true}
              width="100%"
              height={600}
              licenseKey="non-commercial-and-evaluation"
              stretchH="all"
              afterChange={handleAfterChange}
              cells={(row, col) => {
                return { renderer: cellRenderer };
              }}
              contextMenu={{
                items: {
                  'row_above': { name: '위에 행 추가' },
                  'row_below': { name: '아래에 행 추가' },
                  'remove_row': { name: '행 삭제' },
                  'sp1': '---------',
                  'copy': { name: '복사' },
                  'cut': { name: '잘라내기' }
                }
              }}
              afterRemoveRow={() => {
                // 행 삭제 후 남은수량 재계산
                setTimeout(() => {
                  const hot = hotRef.current?.hotInstance;
                  if (hot) {
                    const currentData = hot.getData();
                    setTableData(recalculateRemaining([...currentData]));
                  }
                }, 0);
              }}
              manualRowMove={true}
              allowRemoveRow={true}
              allowInsertRow={true}
              enterMoves={{ row: 1, col: 0 }}
              autoWrapRow={false}
              autoWrapCol={false}
              beforeKeyDown={function(e) {
                const hot = hotRef.current?.hotInstance;
                if (!hot) return;

                const selected = hot.getSelected();
                if (!selected || selected.length === 0) return;

                const [row, col] = selected[0];
                const isLastRow = row === tableData.length - 1;

                // Tab 키: 편집 가능한 컬럼만 이동
                if (e.key === 'Tab') {
                  // Handsontable 이벤트 완전 차단
                  e.stopImmediatePropagation();

                  const currentEditableIndex = EDITABLE_COLS.indexOf(col);
                  let targetRow = row;
                  let targetCol = col;

                  if (e.shiftKey) {
                    // Shift+Tab: 이전 편집 가능 컬럼으로
                    if (currentEditableIndex > 0) {
                      targetCol = EDITABLE_COLS[currentEditableIndex - 1];
                    } else if (row > 0) {
                      targetRow = row - 1;
                      targetCol = EDITABLE_COLS[EDITABLE_COLS.length - 1];
                    }
                  } else {
                    // Tab: 다음 편집 가능 컬럼으로
                    if (currentEditableIndex >= 0 && currentEditableIndex < EDITABLE_COLS.length - 1) {
                      targetCol = EDITABLE_COLS[currentEditableIndex + 1];
                    } else if (currentEditableIndex === EDITABLE_COLS.length - 1) {
                      // 마지막 편집 컬럼 -> 다음 행 첫 번째 편집 컬럼
                      if (row + 1 < tableData.length) {
                        targetRow = row + 1;
                        targetCol = EDITABLE_COLS[0];
                      }
                    } else {
                      // 편집 불가 컬럼에서 Tab -> 첫 번째 편집 컬럼으로
                      targetCol = EDITABLE_COLS[0];
                    }
                  }

                  // 편집 모드 종료 후 이동
                  if (hot.getActiveEditor()?.isOpened()) {
                    hot.getActiveEditor().finishEditing(false);
                  }

                  setTimeout(() => {
                    hot.selectCell(targetRow, targetCol);
                  }, 10);

                  return false; // Handsontable 기본 동작 차단
                }

                // 마지막 행에서 Enter 또는 아래 방향키 누르면 새 행 추가
                if ((e.key === 'Enter' || e.key === 'ArrowDown') && isLastRow) {
                  e.stopImmediatePropagation();
                  addRow();

                  // 새 행의 같은 컬럼으로 포커스 이동
                  setTimeout(() => {
                    hot.selectCell(tableData.length, col);
                  }, 50);

                  return false;
                }
              }}
              beforeChange={(changes, source) => {
                // 로케이션 실시간 포맷팅
                if (!changes) return;
                changes.forEach((change) => {
                  const [row, prop, oldValue, newValue] = change;
                  const col = typeof prop === 'number' ? prop : parseInt(prop);

                  if (col === COL.LOCATION && newValue) {
                    change[3] = formatLocation(newValue);
                  }
                  if (col === COL.EXPIRY_DATE && newValue) {
                    change[3] = formatExpiryDate(newValue);
                  }
                });
              }}
            />

            {/* 요약 정보 */}
            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-semibold mb-2">배정 요약 (상품코드 + ERP요청번호 기준)</h3>
              <div className="grid grid-cols-3 gap-4 text-sm">
                {getSummary().map((item, idx) => {
                  const remaining = item.total - item.assigned;
                  return (
                    <div key={idx} className="flex justify-between">
                      <span className="text-gray-600">{item.productCode} ({item.erpRequestNo}):</span>
                      <span className={remaining > 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold'}>
                        {item.assigned} / {item.total} (남은: {remaining})
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default LocationAssignmentApp;
