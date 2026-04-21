<template>
  <div v-if="normalizedPoints.length > 0" class="space-y-3">
    <div class="flex items-center justify-between text-xs text-surface-500">
      <span>{{ formatCredits(maxValue) }} max</span>
      <span>{{ formatCredits(totalCredits) }} total</span>
    </div>

    <div class="rounded-xl border border-surface-200 bg-gradient-to-b from-surface-50 to-white p-3">
      <svg viewBox="0 0 100 56" preserveAspectRatio="none" class="h-48 w-full overflow-visible">
        <g v-for="gridLine in gridLines" :key="gridLine.y">
          <line
            :x1="padLeft"
            :x2="100 - padRight"
            :y1="gridLine.y"
            :y2="gridLine.y"
            stroke="rgb(226 232 240)"
            stroke-dasharray="2 2"
            stroke-width="0.35"
          />
        </g>

        <polygon :points="areaPoints" fill="rgba(14, 116, 144, 0.14)" />
        <polyline
          :points="linePoints"
          fill="none"
          stroke="rgb(14 116 144)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />

        <circle
          v-for="point in normalizedPoints"
          :key="point.date"
          :cx="point.x"
          :cy="point.y"
          r="0.9"
          fill="rgb(8 145 178)"
        />
      </svg>

      <div class="mt-2 flex justify-between gap-2 text-[11px] text-surface-500">
        <span v-for="label in sampledLabels" :key="`${label.text}-${label.index}`">{{ label.text }}</span>
      </div>
    </div>
  </div>

  <p v-else class="py-8 text-center text-surface-400">{{ emptyMessage }}</p>
</template>

<script setup lang="ts">
interface UsagePoint {
  date: string;
  totalCredits: string | number;
}

const props = withDefaults(defineProps<{
  data: UsagePoint[];
  emptyMessage?: string;
}>(), {
  emptyMessage: 'No usage data yet.',
});

const padLeft = 6;
const padRight = 2;
const padTop = 4;
const padBottom = 6;
const plotWidth = 100 - padLeft - padRight;
const plotHeight = 56 - padTop - padBottom;
const baselineY = padTop + plotHeight;

const normalizedData = computed(() => props.data.map((point) => ({
  ...point,
  totalCredits: Number(point.totalCredits || 0),
})));

const maxValue = computed(() => Math.max(...normalizedData.value.map((point) => point.totalCredits), 1));
const totalCredits = computed(() => normalizedData.value.reduce((sum, point) => sum + point.totalCredits, 0));

const normalizedPoints = computed(() => {
  if (normalizedData.value.length === 0) return [];

  return normalizedData.value.map((point, index) => {
    const x = normalizedData.value.length === 1
      ? padLeft + plotWidth / 2
      : padLeft + (index / (normalizedData.value.length - 1)) * plotWidth;
    const y = padTop + plotHeight - (point.totalCredits / maxValue.value) * plotHeight;

    return {
      ...point,
      x,
      y,
    };
  });
});

const linePoints = computed(() => normalizedPoints.value.map((point) => `${point.x},${point.y}`).join(' '));
const areaPoints = computed(() => {
  if (normalizedPoints.value.length === 0) return '';
  const firstPoint = normalizedPoints.value[0];
  const lastPoint = normalizedPoints.value[normalizedPoints.value.length - 1];
  return `${firstPoint.x},${baselineY} ${linePoints.value} ${lastPoint.x},${baselineY}`;
});

const gridLines = computed(() => Array.from({ length: 4 }, (_, index) => ({
  y: padTop + (index / 3) * plotHeight,
})));

const sampledLabels = computed(() => {
  if (normalizedPoints.value.length === 0) return [];
  const lastIndex = normalizedPoints.value.length - 1;
  const indices = new Set<number>([0, lastIndex]);
  const step = Math.max(1, Math.floor(lastIndex / 4));

  for (let index = step; index < lastIndex; index += step) {
    indices.add(index);
  }

  return Array.from(indices)
    .sort((left, right) => left - right)
    .map((index) => ({
      index,
      text: normalizedPoints.value[index]?.date?.slice(5) || '',
    }));
});

function formatCredits(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}
</script>