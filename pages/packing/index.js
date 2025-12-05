import React, { useState } from 'react';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.min.css';
import { supabase } from '/lib/supabase';
import AuthLayout from '@/components/AuthLayout';

registerAllModules();

/**
 * 모달: "EA/BOX 다르거나, 박스 당 중량이 0.5kg 이상 차이"가 있는 상품들을
 * 한눈에 보여주고, "모두 업데이트" 혹은 "취소" 중 하나를 선택하게 함.
 */
function DiffModal({ isOpen, onClose, conflictRows, onConfirm }) {
  if (!isOpen || !conflictRows || conflictRows.length === 0) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
      onClick={() => onClose(false)}
    >
      <div
        className="bg-white rounded-lg p-6 w-[1200px] max-h-[90vh] overflow-y-auto relative"
        onClick={(e) => e.stopPropagation()}
        style={{ zIndex: 10000 }}
      >
        <h2 className="text-xl font-bold mb-4">아래 상품들의 값이 크게 달라졌습니다.</h2>
        <p className="text-gray-600 mb-4">
          (EA/BOX가 다르거나, 박스 당 중량이 0.5kg 이상 차이 납니다.)
        </p>

        {/* 기존 값 테이블 */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-2">기존 값</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-4 py-2 text-left">상품코드</th>
                  <th className="border px-4 py-2 text-left">상품명</th>
                  <th className="border px-4 py-2 text-right">EA/BOX</th>
                  <th className="border px-4 py-2 text-right">박스 당 중량(kg)</th>
                </tr>
              </thead>
              <tbody>
                {conflictRows.map((item) => (
                  <tr key={`old-${item.productCode}`}>
                    <td className="border px-4 py-2">{item.productCode}</td>
                    <td className="border px-4 py-2">{item.oldName || '-'}</td>
                    <td className="border px-4 py-2 text-right">{item.oldEa || '-'}</td>
                    <td className="border px-4 py-2 text-right">{item.oldWeight || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 새로운 값 테이블 */}
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-2">새로운 값</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-4 py-2 text-left">상품코드</th>
                  <th className="border px-4 py-2 text-left">상품명</th>
                  <th className="border px-4 py-2 text-right">EA/BOX</th>
                  <th className="border px-4 py-2 text-right">박스 당 중량(kg)</th>
                </tr>
              </thead>
              <tbody>
                {conflictRows.map((item) => (
                  <tr key={`new-${item.productCode}`}>
                    <td className="border px-4 py-2">{item.productCode}</td>
                    <td className="border px-4 py-2">{item.newName || '-'}</td>
                    <td className="border px-4 py-2 text-right">{item.newEa || '-'}</td>
                    <td className="border px-4 py-2 text-right">{item.newWeight || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex justify-end space-x-4">
          <button
            className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
            onClick={() => onClose(false)}
          >
            취소
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => onConfirm()}
          >
            모두 업데이트
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PackingList() {
  // (1) Handsontable 초기 데이터
  const [data, setData] = useState([
    {
      pltNo: '',
      productCode: '',
      productName: '',
      eaPerBox: '',
      outboxQty: '',
      convertedQty: '',
      weightPerBox: '',
      totalBoxWeight: '',
      palletLength: '1100',
      palletWidth: '1100',
      palletHeight: '',
      palletTotalWeight: '',
      palletCbm: '',
      lotNo: '',
      expiryDate: ''
    }
  ]);

  // (2) 팔레트 높이 설정 모달 표시 상태
  const [isModalOpen, setIsModalOpen] = useState(false);

  // (3) 합계 (아웃박스, 환산수량)
  const [totals, setTotals] = useState({
    outboxQty: '0.00',
    convertedQty: '0'
  });

  // (4) 저장 중 로딩 상태
  const [isSaving, setIsSaving] = useState(false);

  // (5) "차이 나는 상품" 모달 상태
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [conflictRows, setConflictRows] = useState([]);

  // 모달에서 "모두 업데이트"가 눌렸을 때 실제 DB에 반영할 목록들
  const [pendingInserts, setPendingInserts] = useState([]);
  const [pendingNormalUpdates, setPendingNormalUpdates] = useState([]);
  const [pendingConflictUpdates, setPendingConflictUpdates] = useState([]);

  // ================== 팔레트 총중량 재계산 함수 ==================
  const recalcPalletWeights = (rows) => {
    const pltGroups = {};
    rows.forEach((row) => {
      if (row.pltNo && row.totalBoxWeight) {
        pltGroups[row.pltNo] =
          (pltGroups[row.pltNo] || 0) + Number(row.totalBoxWeight);
      }
    });
    rows.forEach((row) => {
      if (row.pltNo && pltGroups[row.pltNo]) {
        row.palletTotalWeight = (pltGroups[row.pltNo] + 5).toFixed(2);
      }
    });
  };

  // ================== 합계 계산 함수 ==================
  const calculateTotals = (newData) => {
    const sums = newData.reduce(
      (acc, row) => {
        const outboxQty = row.outboxQty
          ? Number(String(row.outboxQty).replace(/,/g, ''))
          : 0;
        const convertedQty = row.convertedQty
          ? Number(String(row.convertedQty).replace(/,/g, ''))
          : 0;

        return {
          outboxQty: acc.outboxQty + outboxQty,
          convertedQty: acc.convertedQty + convertedQty
        };
      },
      { outboxQty: 0, convertedQty: 0 }
    );

    setTotals({
      outboxQty: sums.outboxQty.toFixed(2),
      convertedQty: Math.floor(sums.convertedQty).toLocaleString()
    });
  };

  // ================== Handsontable 컬럼 정의 ==================
  const columns = [
    { data: 'pltNo', title: 'PLT <br>NO' },
    { data: 'productCode', title: '상품코드' ,width:120},
    { data: 'productName', title: '상품명(한글)' },
    { data: 'eaPerBox', title: 'EA/BOX', type: 'text' },
    { data: 'outboxQty', title: '아웃박스<br>수량(box)', type: 'text', readOnly: true },
    { data: 'convertedQty', title: '환산<br>수량(곽)', type: 'text' },
    { data: 'weightPerBox', title: '박스 당<br>중량(kg)', type: 'text' },
    { data: 'totalBoxWeight', title: '박스 총<br>중량(kg)', type: 'text', readOnly: true },
    { data: 'palletLength', title: '팔레트<br>장(mm)', type: 'text', readOnly: true },
    { data: 'palletWidth', title: '팔레트<br>폭(mm)', type: 'text', readOnly: true },
    { data: 'palletHeight', title: '완팔레트<br>고(mm)', type: 'text' },
    { data: 'palletTotalWeight', title: '팔레트<br>총중량(KG)', type: 'text', readOnly: true },
    { data: 'palletCbm', title: '팔레트<br>CBM', type: 'text', readOnly: true },
    { data: 'lotNo', title: '제조번호(LOT)' },
    { data: 'expiryDate', title: '유통기한' }
  ];

  // ================== afterChange ==================
  const handleChange = (changes, source) => {
    if (!changes) return;

    setData((prevData) => {
      const newData = [...prevData];

      changes.forEach(([rowIndex, prop, oldValue, newValue]) => {
        if (!newData[rowIndex]) return;

        newData[rowIndex] = { ...newData[rowIndex], [prop]: newValue };
        const currentRow = newData[rowIndex];

        const toNumber = (val) =>
          val ? Number(String(val).replace(/,/g, '')) : 0;

        if (['convertedQty', 'eaPerBox', 'weightPerBox', 'palletHeight'].includes(prop)) {
          const convertedQty = toNumber(currentRow.convertedQty);
          const eaPerBox = toNumber(currentRow.eaPerBox);
          const weightPerBox = toNumber(currentRow.weightPerBox);

          // outboxQty = convertedQty / eaPerBox
          if (convertedQty && eaPerBox) {
            currentRow.outboxQty = (convertedQty / eaPerBox).toFixed(2);
          }

          // totalBoxWeight = outboxQty * weightPerBox
          if (currentRow.outboxQty && weightPerBox) {
            currentRow.totalBoxWeight = (
              toNumber(currentRow.outboxQty) * weightPerBox
            ).toFixed(2);
          }

          // palletCbm = (1100 * 1100 * palletHeight) / 1000000000
          if (currentRow.palletHeight) {
            currentRow.palletCbm = (
              (1100 * 1100 * toNumber(currentRow.palletHeight)) /
              1000000000
            ).toFixed(4);
          }
        }
      });

      // 팔레트 총중량 재계산
      recalcPalletWeights(newData);

      // 합계 재계산
      calculateTotals(newData);

      return newData;
    });
  };

  // ================== afterRemoveRow ==================
  function handleAfterRemoveRow(index, amount, physicalRows, source) {
    console.log('Physical Rows to Remove:', physicalRows); // 디버깅용 로그

    setData((prevData) => {
      const newData = [...prevData];
      
      // physicalRows를 내림차순 정렬하여 높은 인덱스부터 삭제
      physicalRows.sort((a, b) => b - a);
      
      physicalRows.forEach((rowIndex) => {
        if (rowIndex >= 0 && rowIndex < newData.length) {
          newData.splice(rowIndex, 1);
        }
      });

      console.log('Data after Removal:', newData); // 디버깅용 로그
      
      // 팔레트 총중량 재계산
      recalcPalletWeights(newData);
      
      // 합계 재계산
      calculateTotals(newData);
      
      return newData;
    });
  }

  // ================== 팔레트 높이 설정 모달 로직 ==================
const getPltList = () => {
    const pltNos = new Set();
    data.forEach((row) => {
      if (row.pltNo) pltNos.add(row.pltNo);
    });
    // 자연스러운 정렬 (natural sort)
    return Array.from(pltNos).sort((a, b) => {
      // 문자열을 문자와 숫자 부분으로 분리
      const regex = /(\d+)|(\D+)/g;
      const aParts = a.match(regex) || [];
      const bParts = b.match(regex) || [];
      
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || '';
        const bPart = bParts[i] || '';
        
        // 둘 다 숫자인 경우
        if (/^\d+$/.test(aPart) && /^\d+$/.test(bPart)) {
          const diff = parseInt(aPart, 10) - parseInt(bPart, 10);
          if (diff !== 0) return diff;
        } 
        // 문자열로 비교
        else {
          const diff = aPart.localeCompare(bPart);
          if (diff !== 0) return diff;
        }
      }
      return 0;
    });
  };

  const handlePalletHeightSubmit = (e) => {
    e.preventDefault();

    const pltHeights = document.querySelectorAll('.plt-height-input');
    const newData = [...data];

    pltHeights.forEach((input) => {
      const pltNo = input.dataset.pltno;
      const height = input.value;

      if (pltNo && height) {
        newData.forEach((row) => {
          if (row.pltNo === pltNo) {
            row.palletHeight = height;
            row.palletCbm = (
              (1100 * 1100 * Number(height)) /
              1000000000
            ).toFixed(4);
          }
        });
      }
    });

    // 팔레트 총중량 재계산
    recalcPalletWeights(newData);

    // 합계 재계산
    calculateTotals(newData);

    setData(newData);
    setIsModalOpen(false);
  };

  // ============ 실제 Insert + Update를 수행하는 함수 ============
  async function doInsertsAndUpdates(inserts, normalUpdates, conflictUpdates) {
    // 1) INSERT
    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from('products')
        .insert(inserts);
      if (insertError) {
        console.error('[Insert Error]', insertError);
      }
    }

    // 2) 일반 UPDATE
    for (const row of normalUpdates) {
      const { product_code, product_name, ea_per_box, weight_per_box } = row;
      const { error: updateError } = await supabase
        .from('products')
        .update({
          product_name,
          ea_per_box,
          weight_per_box
        })
        .eq('product_code', product_code);
      if (updateError) {
        console.error('[Update Error]', updateError);
      }
    }

    // 3) 모달에서 확인받은 충돌(Conflict) UPDATE
    for (const row of conflictUpdates) {
      const { product_code, product_name, ea_per_box, weight_per_box } =
        row.payload;
      const { error: conflictError } = await supabase
        .from('products')
        .update({
          product_name,
          ea_per_box,
          weight_per_box
        })
        .eq('product_code', product_code);

      if (conflictError) {
        console.error('[Conflict Update Error]', conflictError);
      }
    }
  }

  // ============ "저장하기" 버튼 클릭 시 로직 ============
  const handleSave = async () => {
    setIsSaving(true);
  
    try {
      const inserts = [];
      const normalUpdates = [];
      const conflictUpdates = [];
      const processedCodes = new Set();
  
      // 1) 모든 Row 스캔
      for (const row of data) {
        // 필요한 변수 추출 및 가공
        const rawProductCode = row.productCode?.trim();
        if (!rawProductCode || processedCodes.has(rawProductCode)) {
          continue;
        }
        processedCodes.add(rawProductCode);
  
        const productName = row.productName || null;
        const eaPerBox = row.eaPerBox
          ? parseInt(String(row.eaPerBox).replace(/,/g, ''), 10)
          : null;
        const weightPerBox = row.weightPerBox
          ? parseFloat(String(row.weightPerBox).replace(/,/g, ''))
          : null;
  
        // DB 조회
        const { data: existing, error } = await supabase
          .from('products')
          .select('*')
          .eq('product_code', rawProductCode)
          .maybeSingle();
  
        if (error && error.code !== 'PGRST116') {
          console.error('[Fetch Error]', error);
          continue;
        }
  
        const newData = {
          product_code: rawProductCode,
          product_name: productName,
          ea_per_box: eaPerBox,
          weight_per_box: weightPerBox,
        };
  
        if (!existing) {
          // 새 상품
          inserts.push(newData);
        } else {
          // 기존 상품 업데이트
          const oldName = existing.product_name || '';
          const oldEa = existing.ea_per_box || null;
          const oldWeight = existing.weight_per_box || null;
  
          const eaChanged = eaPerBox !== null && oldEa !== eaPerBox;
          const weightDiff =
            weightPerBox !== null && oldWeight !== null
              ? Math.abs(weightPerBox - oldWeight)
              : 0;
          const conflict = eaChanged || weightDiff >= 0.5;
  
          if (conflict) {
            conflictUpdates.push({
              productCode: rawProductCode,
              oldName,
              newName: productName,
              oldEa,
              newEa: eaPerBox,
              oldWeight,
              newWeight: weightPerBox,
              payload: newData,
            });
          } else {
            const updatePayload = {};
            if (productName !== null) updatePayload.product_name = productName;
            if (eaPerBox !== null) updatePayload.ea_per_box = eaPerBox;
            if (weightPerBox !== null)
              updatePayload.weight_per_box = weightPerBox;
  
            if (Object.keys(updatePayload).length > 0) {
              normalUpdates.push({
                product_code: rawProductCode,
                ...updatePayload,
              });
            }
          }
        }
      }
  
      // 2) conflictUpdates가 있으면 모달로 확인
      if (conflictUpdates.length > 0) {
        const conflictsForModal = conflictUpdates.map((item) => ({
          productCode: item.productCode,
          oldName: item.oldName,
          newName: item.newName,
          oldEa: item.oldEa,
          newEa: item.newEa,
          oldWeight: item.oldWeight,
          newWeight: item.newWeight,
        }));
  
        setConflictRows(conflictsForModal);
        setPendingInserts(inserts);
        setPendingNormalUpdates(normalUpdates);
        setPendingConflictUpdates(conflictUpdates);
        setShowDiffModal(true);
      } else {
        // 3) conflict 없으면 바로 처리
        await doInsertsAndUpdates(inserts, normalUpdates, []);
        alert('저장이 완료되었습니다!');
      }
    } catch (err) {
      console.error('[handleSave error]', err);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };
  
  // ========== 모달에서 "모두 업데이트" 클릭 시 ==========
  const handleConfirmDiff = async () => {
    setShowDiffModal(false); // 모달 닫기
    setIsSaving(true);

    try {
      await doInsertsAndUpdates(
        pendingInserts,
        pendingNormalUpdates,
        pendingConflictUpdates
      );
      alert('저장이 완료되었습니다!');
    } catch (err) {
      console.error('[handleConfirmDiff error]', err);
      alert('저장 중 에러가 발생했습니다.');
    } finally {
      // 상태들 초기화
      setPendingInserts([]);
      setPendingNormalUpdates([]);
      setPendingConflictUpdates([]);
      setConflictRows([]);
      setIsSaving(false);
    }
  };

  // ========== 모달에서 "취소" 버튼 클릭 시 ==========
  const handleCloseDiffModal = (confirmed) => {
    // confirmed=false => 저장 취소
    setShowDiffModal(false);

    // 대기 중이던 업데이트, 인서트 목록들도 비워버림
    setPendingInserts([]);
    setPendingNormalUpdates([]);
    setPendingConflictUpdates([]);
    setConflictRows([]);

    alert('저장이 취소되었습니다.');
  };

  // ================== 렌더링 ==================
  return (
    <AuthLayout>
      <div className="p-4">
        <div className="flex flex-col mb-2">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold w-[200px]">패킹리스트 관리</h1>
          
          {/* 중앙에 3개 요소를 함께 배치 */}
          <div className="flex-1 flex justify-center items-center space-x-4">
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm whitespace-nowrap"
            >
              팔레트 높이 설정
            </button>
            <div className="flex items-center bg-gray-100 px-3 py-1.5 rounded">
              <span className="font-semibold mr-2">총 아웃박스 수량:</span>
              <span>{totals.outboxQty}</span>
            </div>
            <div className="flex items-center bg-blue-100 px-4 py-2 rounded border border-blue-300 shadow-sm">
              <span className="text-lg font-bold mr-2 text-blue-800">총 수량:</span>
              <span className="text-xl font-bold text-blue-800">{totals.convertedQty}</span>
            </div>
          </div>
          
          {/* 저장 버튼을 오른쪽에 배치 */}
          <div className="w-[200px] flex justify-end">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={`px-3 py-1.5 text-white rounded text-sm ${
                isSaving
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-500 hover:bg-green-600'
              }`}
            >
              {isSaving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </div>
        {isSaving && <div className="text-blue-600 text-sm text-center mt-1">잠시만 기다려주세요...</div>}
      </div>
      <div className="text-gray-600 text-sm mt-2">
          ※ 행 삭제 시 2행씩 삭제됨 행 삭제 X
        </div>
      {/* 팔레트 높이 설정 모달 */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
          onClick={() => setIsModalOpen(false)}
        >
          <div
            className="bg-white rounded-lg p-6 w-[600px] max-h-[80vh] overflow-y-auto relative"
            onClick={(e) => e.stopPropagation()}
            style={{ zIndex: 10000 }}
          >
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">팔레트 높이 일괄 설정</h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handlePalletHeightSubmit} className="space-y-4">
              <div className="overflow-auto max-h-[400px]">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left">PLT NO</th>
                      <th className="px-4 py-2 text-left">현재 높이(mm)</th>
                      <th className="px-4 py-2 text-left">새 높이(mm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getPltList().map((pltNo) => {
                      const currentHeight =
                        data.find((row) => row.pltNo === pltNo)?.palletHeight ||
                        '';
                      return (
                        <tr key={pltNo} className="border-b">
                          <td className="px-4 py-2">{pltNo}</td>
                          <td className="px-4 py-2">{currentHeight}</td>
                          <td className="px-4 py-2">
                            <input
                              type="text"
                              defaultValue={currentHeight}
                              data-pltno={pltNo}
                              className="plt-height-input w-full px-3 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="submit"
                className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                일괄 적용
              </button>
            </form>
          </div>
        </div>
      )}

      {/* EA/BOX 또는 중량 차이가 큰 상품들 모달 */}
      <DiffModal
        isOpen={showDiffModal}
        onClose={handleCloseDiffModal}
        conflictRows={conflictRows}
        onConfirm={handleConfirmDiff}
      />

      {/* Handsontable */}
      <HotTable
        data={data}
        columns={columns}
        colHeaders={true}
        rowHeaders={true}
        licenseKey="non-commercial-and-evaluation"
        afterChange={handleChange}
        afterRemoveRow={handleAfterRemoveRow}
        contextMenu={true}
        minSpareRows={1}
        columnSorting={true} // 정렬 활성화 시 문제가 계속되면 false로 테스트
        manualColumnResize={true}
        manualRowResize={true}
        mergeCells={true}        
        wordWrap={true}
        autoRowSize={false}   // 자동 행 크기 비활성화
        rowHeights={23}       // 행 높이 고정
        colHeaderHeight={30}  // 헤더 높이 고정
        overflow="visible"    // 오버플로우 허용
        copyable={true}
        copyPaste={true}
        fillHandle={true}
          
        // height prop 제거
      />
      </div>
    </AuthLayout>
  );
}