import React, { useState, useRef, useCallback } from 'react';
import { HotTable } from '@handsontable/react';
import { registerAllModules } from 'handsontable/registry';
import 'handsontable/dist/handsontable.full.min.css';
import { supabase } from '@/lib/supabase';
import ExcelJS from 'exceljs';
import AuthLayout from '@/components/AuthLayout';
import { useAuth } from '../_app';

registerAllModules();

// 빈 행 생성 함수
const createEmptyRow = () => ({
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
});

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
  const hotRef = useRef(null);
  const { user } = useAuth();

  // 초기 데이터 (기본값 포함)
  const [data, setData] = useState([createEmptyRow()]);

  // 팔레트 높이 설정 모달 표시 상태
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 합계 (아웃박스, 환산수량)
  const [totals, setTotals] = useState({
    outboxQty: '0.00',
    convertedQty: '0'
  });

  // 저장 중 로딩 상태
  const [isSaving, setIsSaving] = useState(false);

  // "차이 나는 상품" 모달 상태
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [conflictRows, setConflictRows] = useState([]);

  // 모달에서 "모두 업데이트"가 눌렸을 때 실제 DB에 반영할 목록들
  const [pendingInserts, setPendingInserts] = useState([]);
  const [pendingNormalUpdates, setPendingNormalUpdates] = useState([]);
  const [pendingConflictUpdates, setPendingConflictUpdates] = useState([]);

  // 숫자 변환 유틸
  const toNumber = (val) => val ? Number(String(val).replace(/,/g, '')) : 0;

  // 팔레트 총중량 재계산 함수
  const recalcPalletWeights = useCallback((rows) => {
    const pltGroups = {};
    rows.forEach((row) => {
      if (row.pltNo && row.totalBoxWeight) {
        pltGroups[row.pltNo] = (pltGroups[row.pltNo] || 0) + toNumber(row.totalBoxWeight);
      }
    });
    rows.forEach((row) => {
      if (row.pltNo && pltGroups[row.pltNo] !== undefined) {
        row.palletTotalWeight = (pltGroups[row.pltNo] + 5).toFixed(2);
      }
    });
  }, []);

  // 합계 계산 함수
  const calculateTotals = useCallback((newData) => {
    const sums = newData.reduce(
      (acc, row) => {
        const outboxQty = toNumber(row.outboxQty);
        const convertedQty = toNumber(row.convertedQty);
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
  }, []);

  // 행 계산 로직 (outboxQty, totalBoxWeight, palletCbm)
  const calculateRow = useCallback((row) => {
    const convertedQty = toNumber(row.convertedQty);
    const eaPerBox = toNumber(row.eaPerBox);
    const weightPerBox = toNumber(row.weightPerBox);
    const palletHeight = toNumber(row.palletHeight);
    const palletLength = toNumber(row.palletLength) || 1100;
    const palletWidth = toNumber(row.palletWidth) || 1100;

    // outboxQty = convertedQty / eaPerBox
    if (convertedQty && eaPerBox) {
      row.outboxQty = (convertedQty / eaPerBox).toFixed(2);
    }

    // totalBoxWeight = outboxQty * weightPerBox
    const outboxQty = toNumber(row.outboxQty);
    if (outboxQty && weightPerBox) {
      row.totalBoxWeight = (outboxQty * weightPerBox).toFixed(2);
    }

    // palletCbm = (length * width * height) / 1000000000
    if (palletHeight) {
      row.palletCbm = ((palletLength * palletWidth * palletHeight) / 1000000000).toFixed(4);
    }

    return row;
  }, []);

  // Handsontable 컬럼 정의
  const columns = [
    { data: 'pltNo', title: 'PLT<br>NO', width: 45 },
    { data: 'productCode', title: '상품코드', width: 100 },
    { data: 'productName', title: '상품명(한글)', width: 320 },
    { data: 'eaPerBox', title: 'EA/BOX', type: 'text', width: 55 },
    { data: 'outboxQty', title: '아웃박스<br>수량(box)', type: 'text', readOnly: true, width: 65 },
    { data: 'convertedQty', title: '환산<br>수량(곽)', type: 'text', width: 65 },
    { data: 'weightPerBox', title: '박스 당<br>중량(kg)', type: 'text', width: 65 },
    { data: 'totalBoxWeight', title: '박스 총<br>중량(kg)', type: 'text', readOnly: true, width: 65 },
    { data: 'palletLength', title: '팔레트<br>장(mm)', type: 'text', readOnly: true, width: 55 },
    { data: 'palletWidth', title: '팔레트<br>폭(mm)', type: 'text', readOnly: true, width: 55 },
    { data: 'palletHeight', title: '완팔레트<br>고(mm)', type: 'text', width: 65 },
    { data: 'palletTotalWeight', title: '팔레트<br>총중량(KG)', type: 'text', readOnly: true, width: 70 },
    { data: 'palletCbm', title: '팔레트<br>CBM', type: 'text', readOnly: true, width: 60 },
    { data: 'lotNo', title: '제조번호(LOT)', width: 100 },
    { data: 'expiryDate', title: '유통기한', width: 85 }
  ];

  // afterChange 핸들러
  const handleAfterChange = useCallback((changes, source) => {
    if (!changes || source === 'loadData') return;

    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    // 현재 데이터 가져오기
    const currentData = hot.getSourceData().map(row => ({ ...row }));
    let needsRender = false;

    changes.forEach(([rowIndex, prop, oldValue, newValue]) => {
      if (rowIndex >= currentData.length) return;

      const row = currentData[rowIndex];

      // 새 행에 기본값 설정 (장, 폭)
      if (!row.palletLength) row.palletLength = '1100';
      if (!row.palletWidth) row.palletWidth = '1100';

      // 계산이 필요한 필드가 변경된 경우
      if (['convertedQty', 'eaPerBox', 'weightPerBox', 'palletHeight'].includes(prop)) {
        calculateRow(row);
        needsRender = true;
      }
    });

    // 팔레트 총중량 재계산
    recalcPalletWeights(currentData);

    // 합계 재계산
    calculateTotals(currentData);

    // 데이터 업데이트
    if (needsRender) {
      hot.loadData(currentData);
    }

    setData(currentData);
  }, [calculateRow, recalcPalletWeights, calculateTotals]);

  // beforeCreateRow - 새 행 생성 전 기본값 설정
  const handleBeforeCreateRow = useCallback((index, amount, source) => {
    // 이 훅은 행이 생성되기 전에 호출됨
    return true;
  }, []);

  // afterCreateRow - 새 행 생성 후 기본값 설정
  const handleAfterCreateRow = useCallback((index, amount, source) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    // 새로 생성된 행에 기본값 설정
    for (let i = 0; i < amount; i++) {
      const rowIndex = index + i;
      hot.setDataAtRowProp(rowIndex, 'palletLength', '1100', 'auto');
      hot.setDataAtRowProp(rowIndex, 'palletWidth', '1100', 'auto');
    }
  }, []);

  // afterRemoveRow - 행 삭제 후 데이터 동기화
  const handleAfterRemoveRow = useCallback((index, amount, physicalRows, source) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    // Handsontable에서 현재 데이터 가져오기 (이미 삭제된 상태)
    const currentData = hot.getSourceData().map(row => ({ ...row }));

    // 팔레트 총중량 재계산
    recalcPalletWeights(currentData);

    // 합계 재계산
    calculateTotals(currentData);

    // React state 동기화
    setData(currentData);
  }, [recalcPalletWeights, calculateTotals]);

  // 팔레트 높이 설정 모달 로직
  const getPltList = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    const sourceData = hot ? hot.getSourceData() : data;

    const pltNos = new Set();
    sourceData.forEach((row) => {
      if (row.pltNo) pltNos.add(row.pltNo);
    });

    // 자연스러운 정렬 (natural sort)
    return Array.from(pltNos).sort((a, b) => {
      const regex = /(\d+)|(\D+)/g;
      const aParts = String(a).match(regex) || [];
      const bParts = String(b).match(regex) || [];

      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || '';
        const bPart = bParts[i] || '';

        if (/^\d+$/.test(aPart) && /^\d+$/.test(bPart)) {
          const diff = parseInt(aPart, 10) - parseInt(bPart, 10);
          if (diff !== 0) return diff;
        } else {
          const diff = aPart.localeCompare(bPart);
          if (diff !== 0) return diff;
        }
      }
      return 0;
    });
  }, [data]);

  const handlePalletHeightSubmit = useCallback((e) => {
    e.preventDefault();

    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    const pltHeights = document.querySelectorAll('.plt-height-input');
    const currentData = hot.getSourceData().map(row => ({ ...row }));

    pltHeights.forEach((input) => {
      const pltNo = input.dataset.pltno;
      const height = input.value;

      if (pltNo && height) {
        currentData.forEach((row) => {
          if (row.pltNo === pltNo) {
            row.palletHeight = height;
            const palletLength = toNumber(row.palletLength) || 1100;
            const palletWidth = toNumber(row.palletWidth) || 1100;
            row.palletCbm = ((palletLength * palletWidth * Number(height)) / 1000000000).toFixed(4);
          }
        });
      }
    });

    // 팔레트 총중량 재계산
    recalcPalletWeights(currentData);

    // 합계 재계산
    calculateTotals(currentData);

    // 데이터 업데이트
    hot.loadData(currentData);
    setData(currentData);
    setIsModalOpen(false);
  }, [recalcPalletWeights, calculateTotals]);

  // 행 추가 버튼
  const handleAddRow = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    const newRow = createEmptyRow();
    const currentData = hot.getSourceData().map(row => ({ ...row }));
    currentData.push(newRow);

    hot.loadData(currentData);
    setData(currentData);
  }, []);


  // 실제 Insert + Update를 수행하는 함수
  // - 상품명: 기존 DB에 있으면 덮어쓰지 않음
  // - 입수량/무게: 변경 시 이력 테이블에 기록
  async function doInsertsAndUpdates(inserts, normalUpdates, conflictUpdates) {
    const userEmail = user?.email || 'unknown';

    // 1) INSERT - 신규 상품
    if (inserts.length > 0) {
      const { error: insertError } = await supabase
        .from('products')
        .insert(inserts);
      if (insertError) {
        console.error('[Insert Error]', insertError);
      }

      // 신규 상품도 이력에 기록
      const historyRecords = inserts.map(item => ({
        product_code: item.product_code,
        product_name: item.product_name,
        ea_per_box: item.ea_per_box,
        weight_per_box: item.weight_per_box,
        changed_by: userEmail,
        source: 'PL'
      }));

      if (historyRecords.length > 0) {
        const { error: historyError } = await supabase
          .from('product_history')
          .insert(historyRecords);
        if (historyError) {
          console.error('[History Insert Error]', historyError);
        }
      }
    }

    // 2) 일반 UPDATE - 상품명은 업데이트하지 않음
    for (const row of normalUpdates) {
      const { product_code, ea_per_box, weight_per_box } = row;

      // 입수량이나 무게가 있는 경우에만 업데이트
      const updatePayload = {};
      if (ea_per_box !== null && ea_per_box !== undefined) {
        updatePayload.ea_per_box = ea_per_box;
      }
      if (weight_per_box !== null && weight_per_box !== undefined) {
        updatePayload.weight_per_box = weight_per_box;
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error: updateError } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('product_code', product_code);
        if (updateError) {
          console.error('[Update Error]', updateError);
        }

        // 이력 저장
        const { error: historyError } = await supabase
          .from('product_history')
          .insert({
            product_code,
            ea_per_box: ea_per_box,
            weight_per_box: weight_per_box,
            changed_by: userEmail,
            source: 'PL'
          });
        if (historyError) {
          console.error('[History Insert Error]', historyError);
        }
      }
    }

    // 3) 모달에서 확인받은 충돌(Conflict) UPDATE - 상품명은 업데이트하지 않음
    for (const row of conflictUpdates) {
      const { product_code, ea_per_box, weight_per_box } = row.payload;

      const updatePayload = {};
      if (ea_per_box !== null && ea_per_box !== undefined) {
        updatePayload.ea_per_box = ea_per_box;
      }
      if (weight_per_box !== null && weight_per_box !== undefined) {
        updatePayload.weight_per_box = weight_per_box;
      }

      if (Object.keys(updatePayload).length > 0) {
        const { error: conflictError } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('product_code', product_code);
        if (conflictError) {
          console.error('[Conflict Update Error]', conflictError);
        }

        // 이력 저장
        const { error: historyError } = await supabase
          .from('product_history')
          .insert({
            product_code,
            ea_per_box: ea_per_box,
            weight_per_box: weight_per_box,
            changed_by: userEmail,
            source: 'PL'
          });
        if (historyError) {
          console.error('[History Insert Error]', historyError);
        }
      }
    }
  }

  // "저장하기" 버튼 클릭 시 로직
  const handleSave = async () => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    setIsSaving(true);

    try {
      const inserts = [];
      const normalUpdates = [];
      const conflictUpdates = [];
      const processedCodes = new Set();

      const sourceData = hot.getSourceData();

      // 1) 모든 Row 스캔
      for (const row of sourceData) {
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
            if (weightPerBox !== null) updatePayload.weight_per_box = weightPerBox;

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

  // 모달에서 "모두 업데이트" 클릭 시
  const handleConfirmDiff = async () => {
    setShowDiffModal(false);
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
      setPendingInserts([]);
      setPendingNormalUpdates([]);
      setPendingConflictUpdates([]);
      setConflictRows([]);
      setIsSaving(false);
    }
  };

  // 모달에서 "취소" 버튼 클릭 시
  const handleCloseDiffModal = (confirmed) => {
    setShowDiffModal(false);
    setPendingInserts([]);
    setPendingNormalUpdates([]);
    setPendingConflictUpdates([]);
    setConflictRows([]);
    alert('저장이 취소되었습니다.');
  };

  // gibon.xlsx 양식으로 엑셀 다운로드
  const handleExcelDownload = useCallback(async () => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;

    const sourceData = hot.getSourceData();

    // 데이터가 없거나 빈 행만 있는 경우
    const validData = sourceData.filter(row => row.productCode || row.productName);
    if (validData.length === 0) {
      alert('다운로드할 데이터가 없습니다.');
      return;
    }

    try {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('패킹리스트');

      // 페이지 설정
      sheet.pageSetup = {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      };

      // 열 너비 설정 (gibon.xlsx 기준 - A열(Date&Con.No) 제외)
      sheet.columns = [
        { width: 10 },  // A: 쉬핑넘버 (PALLET NO.)
        { width: 15 },  // B: 상품코드
        { width: 50 },  // C: 상품명
        { width: 8 },   // D: 아웃박스 입수량
        { width: 10 },  // E: 아웃박스수량
        { width: 10 },  // F: 환산수량
        { width: 10 },  // G: 박스 당 순 중량
        { width: 10 },  // H: 박스 당 중량
        { width: 10 },  // I: 총 박스 순 중량
        { width: 10 },  // J: 총 박스 중량
        { width: 8 },   // K: 장
        { width: 8 },   // L: 폭
        { width: 8 },   // M: 고
        { width: 12 },  // N: 팔레트 총중량
        { width: 10 },  // O: CBM
        { width: 15 },  // P: 제조번호(LOT)
        { width: 12 },  // Q: 유통기한
      ];

      // 스타일 정의
      const headerStyle = {
        font: { bold: true, size: 10 },
        alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
        border: {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        },
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE2EFDA' } // 연한 녹색
        }
      };

      const dataStyle = {
        font: { size: 10 },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        }
      };

      // 1행: 영업 담당자 정보
      sheet.addRow(['영업 담당자', '', '★기재 필요한 내용에 노란색 표시 후, 작성요청 必 (사전 미요청내용에 대해 패킹완료 후 OR 출고완료 후 기재 불가)']);
      sheet.mergeCells('C1:Q1');

      // 2행: 고객사 정보
      sheet.addRow(['고객사(입고지)', '', '★파일명 [출고요청일(WMS 및 ERP 등록일자) + 고객사명(입고지명) + 패킹리스트] 통일 하여 요청 必']);
      sheet.mergeCells('C2:Q2');

      // 3행: 출고요청 일자
      sheet.addRow(['출고요청 일자\n(=WMS & ERP 등록일자)', '', '★상품명(영문) 기재 필요 시. 영업담당자 기재하여 패킹리스트 작성요청 必 (태은 및 제조사에서 영문명 확인불가)']);
      sheet.mergeCells('C3:Q3');

      // 4행: PLT적재 박스수량 안내
      sheet.addRow(['', '', '', '', '▼PLT적재 박스수량', '', '', '', '', '', '팔레트 (PLT 자체무게 = ____5____KG)']);
      sheet.mergeCells('E4:J4');
      sheet.mergeCells('K4:Q4');

      // 5행: 헤더
      const headers = [
        '쉬핑넘버\n(PALLET NO.)',
        '상품코드',
        '상품명',
        '아웃박스\n입수량\n(곽)',
        '아웃박스수량\n(box)',
        '환산수량\n(곽)',
        '박스 당\n순 중량\n(kg)',
        '박스 당\n중량\n(kg)',
        '총 박스\n순 중량\n(kg)',
        '총 박스\n중량\n(kg)',
        '장\n(mm)',
        '폭\n(mm)',
        '고\n(mm)',
        '팔레트\n총중량(KG)',
        'CBM',
        '제조번호(LOT)',
        '유통기한'
      ];
      const headerRow = sheet.addRow(headers);
      headerRow.height = 45;
      headerRow.eachCell((cell) => {
        cell.font = headerStyle.font;
        cell.alignment = headerStyle.alignment;
        cell.border = headerStyle.border;
        cell.fill = headerStyle.fill;
      });

      // 데이터 행 추가
      let totalConvertedQty = 0;
      let totalOutboxQty = 0;
      let totalBoxWeight = 0;
      let totalNetBoxWeight = 0;

      validData.forEach((row) => {
        const eaPerBox = toNumber(row.eaPerBox);
        const convertedQty = toNumber(row.convertedQty);
        const outboxQty = toNumber(row.outboxQty);
        const weightPerBox = toNumber(row.weightPerBox);
        const totalWeight = toNumber(row.totalBoxWeight);
        const palletLength = toNumber(row.palletLength) || 1100;
        const palletWidth = toNumber(row.palletWidth) || 1100;
        const palletHeight = toNumber(row.palletHeight);
        const palletTotalWeight = toNumber(row.palletTotalWeight);
        const palletCbm = toNumber(row.palletCbm);

        // 순 중량 계산 (박스 당 중량 - 0.7kg)
        const netWeightPerBox = weightPerBox > 0 ? Math.round((weightPerBox - 0.7) * 100) / 100 : '';
        const totalNetWeight = outboxQty && netWeightPerBox ? Math.round(outboxQty * netWeightPerBox * 100) / 100 : '';

        const dataRow = sheet.addRow([
          row.pltNo || '',                 // A: PALLET NO.
          row.productCode || '',           // B: 상품코드
          row.productName || '',           // C: 상품명
          eaPerBox || '',                  // D: 아웃박스 입수량
          outboxQty || '',                 // E: 아웃박스수량
          convertedQty || '',              // F: 환산수량
          netWeightPerBox || '',           // G: 박스 당 순 중량
          weightPerBox || '',              // H: 박스 당 중량
          totalNetWeight || '',            // I: 총 박스 순 중량
          totalWeight || '',               // J: 총 박스 중량
          palletLength || '',              // K: 장
          palletWidth || '',               // L: 폭
          palletHeight || '',              // M: 고
          palletTotalWeight || '',         // N: 팔레트 총중량
          palletCbm || '',                 // O: CBM
          row.lotNo || '',                 // P: 제조번호(LOT)
          row.expiryDate || ''             // Q: 유통기한
        ]);

        dataRow.eachCell((cell, colNumber) => {
          cell.font = dataStyle.font;
          cell.alignment = dataStyle.alignment;
          cell.border = dataStyle.border;

          // 숫자 컬럼 오른쪽 정렬
          if ([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].includes(colNumber)) {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }
          // 상품명 왼쪽 정렬
          if (colNumber === 3) {
            cell.alignment = { horizontal: 'left', vertical: 'middle' };
          }
        });

        // 합계 계산
        totalConvertedQty += convertedQty;
        totalOutboxQty += outboxQty;
        totalBoxWeight += totalWeight;
        totalNetBoxWeight += (typeof totalNetWeight === 'number' ? totalNetWeight : 0);
      });

      // 합계 행 추가
      const totalRow = sheet.addRow([
        '', '', '합계', '', totalOutboxQty.toFixed(2), totalConvertedQty, '', '', totalNetBoxWeight.toFixed(2), totalBoxWeight.toFixed(2),
        '', '', '', '', '', '', ''
      ]);
      totalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = dataStyle.border;
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF2CC' } // 연한 노란색
        };
        if ([5, 6, 9, 10].includes(colNumber)) {
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
        }
      });

      // 파일 다운로드
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `패킹리스트_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);

    } catch (err) {
      console.error('엑셀 다운로드 오류:', err);
      alert('엑셀 다운로드 중 오류가 발생했습니다.');
    }
  }, [toNumber]);

  // 렌더링
  return (
    <AuthLayout>
    <div className="p-4">
      <div className="flex flex-col mb-2">
        <div className="flex items-center">
          <h1 className="text-2xl font-bold w-[200px]">패킹리스트 관리</h1>

          {/* 중앙에 요소들 배치 */}
          <div className="flex-1 flex justify-center items-center space-x-4">
            <button
              onClick={handleAddRow}
              className="px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 text-sm whitespace-nowrap"
            >
              + 행 추가
            </button>
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

          {/* 저장/다운로드 버튼을 오른쪽에 배치 */}
          <div className="w-[280px] flex justify-end space-x-2">
            <button
              onClick={handleExcelDownload}
              className="px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm whitespace-nowrap"
            >
              엑셀 다운로드
            </button>
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
                      const hot = hotRef.current?.hotInstance;
                      const sourceData = hot ? hot.getSourceData() : data;
                      const currentHeight = sourceData.find((row) => row.pltNo === pltNo)?.palletHeight || '';
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
        ref={hotRef}
        data={data}
        columns={columns}
        colHeaders={true}
        rowHeaders={true}
        licenseKey="non-commercial-and-evaluation"
        afterChange={handleAfterChange}
        afterCreateRow={handleAfterCreateRow}
        beforeCreateRow={handleBeforeCreateRow}
        afterRemoveRow={handleAfterRemoveRow}
        contextMenu={{
          items: {
            'row_above': { name: '위에 행 추가' },
            'row_below': { name: '아래에 행 추가' },
            'separator1': '---------',
            'remove_row': { name: '행 삭제' },
            'separator2': '---------',
            'copy': { name: '복사' },
            'cut': { name: '잘라내기' }
          }
        }}
        columnSorting={true}
        minSpareRows={0}
        manualColumnResize={true}
        manualRowResize={true}
        wordWrap={true}
        autoRowSize={false}
        rowHeights={23}
        colHeaderHeight={40}
        copyable={true}
        copyPaste={true}
        fillHandle={true}
        stretchH="all"
        height="auto"
        className="htCenter"
      />
    </div>
    </AuthLayout>
  );
}
