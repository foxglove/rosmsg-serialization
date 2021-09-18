interface Indexable {
  [index: number]: unknown;
}

interface TypedArrayConstructor<T> {
  new (length?: number): T;
  new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): T;
  BYTES_PER_ELEMENT: number;
}

// Given a TypeArray constructor (Int32Array, Float32Array, etc), create a deserialization function
// This deserialization function tries to first use aligned access and falls back to iteration
function MakeTypedArrayDeserialze<T extends Indexable>(
  TypedArrayConstructor: TypedArrayConstructor<T> | undefined,
  getter:
    | "getInt8"
    | "getUint8"
    | "getInt16"
    | "getUint16"
    | "getInt32"
    | "getUint32"
    | "getBigInt64"
    | "getBigUint64"
    | "getFloat32"
    | "getFloat64",
) {
  if (TypedArrayConstructor == undefined) {
    console.warn("bigint arrays are not supported in this environment");
  }
  return (view: DataView, offset: number, len: number): T => {
    if (TypedArrayConstructor == undefined) {
      throw new Error("bigint arrays are not supported in this environment");
    }
    let currentOffset = offset;
    const totalOffset = view.byteOffset + currentOffset;
    const size = TypedArrayConstructor.BYTES_PER_ELEMENT * len;

    const maxSize = view.byteLength - offset;
    if (size < 0 || size > maxSize) {
      throw new RangeError(
        `Array(${getter}) deserialization error: size ${size}, maxSize ${maxSize}`,
      );
    }

    // new TypedArray(...) will throw if you try to make a typed array on unaligned boundary
    // but for aligned access we can use a typed array and avoid any extra memory alloc/copy
    if (totalOffset % TypedArrayConstructor.BYTES_PER_ELEMENT === 0) {
      return new TypedArrayConstructor(view.buffer, totalOffset, len);
    }

    // benchmarks indicate for len < ~10 doing each individually is faster than copy
    if (len < 10) {
      const arr = new TypedArrayConstructor(len);
      for (let idx = 0; idx < len; ++idx) {
        arr[idx] = view[getter](currentOffset, true);
        currentOffset += TypedArrayConstructor.BYTES_PER_ELEMENT;
      }
      return arr;
    }

    // if the length is > 10, then doing a copy of the data to align it is faster
    // using _set_ is slightly faster than slice on the array buffer according to today's benchmarks
    const copy = new Uint8Array(size);
    copy.set(new Uint8Array(view.buffer, totalOffset, size));
    return new TypedArrayConstructor(copy.buffer, copy.byteOffset, len);
  };
}

// Sizes for builtin types - if a type has a fixed size, the deserializer is able to optimize
export const fixedSizeTypes = new Map([
  ["bool", 1],
  ["int8", 1],
  ["uint8", 1],
  ["int16", 2],
  ["uint16", 2],
  ["int32", 4],
  ["uint32", 4],
  ["int64", 8],
  ["uint64", 8],
  ["float32", 4],
  ["float64", 8],
  ["time", 8],
  ["duration", 8],
] as const);
export type FixedSizeTypes = Parameters<typeof fixedSizeTypes.get>[0];

type BuiltinTypeMap = {
  bool: boolean;
  int8: number;
  uint8: number;
  int16: number;
  uint16: number;
  int32: number;
  uint32: number;
  int64: bigint;
  uint64: bigint;
  float32: number;
  float64: number;
  time: { sec: number; nsec: number };
  duration: { sec: number; nsec: number };
};

type BuiltinArrayTypeMap = {
  int8: Int8Array;
  uint8: Uint8Array;
  int16: Int16Array;
  uint16: Uint16Array;
  int32: Int32Array;
  uint32: Uint32Array;
  int64: BigInt64Array;
  uint64: BigUint64Array;
  float32: Float32Array;
  float64: Float64Array;
};

// This intersection enforces a TypeScript error if deserializers and fixedSizeTypes get out of sync
// in either direction
type BuiltinTypes = keyof BuiltinTypeMap & FixedSizeTypes;

type BuiltinReaders = {
  [K in BuiltinTypes]: (view: DataView, offset: number) => BuiltinTypeMap[K];
} & {
  [K in BuiltinTypes as `${K}Array`]: (
    view: DataView,
    offset: number,
    len: number,
  ) => K extends keyof BuiltinArrayTypeMap ? BuiltinArrayTypeMap[K] : BuiltinTypeMap[K][];
};

const decoder = new TextDecoder("utf8");

export const deserializers: BuiltinReaders & {
  string: (view: DataView, offset: number) => string;
  fixedArray: (
    view: DataView,
    offset: number,
    len: number,
    elementDeser: (view: DataView, offset: number) => unknown,
    elementSize: (view: DataView, offset: number) => number,
  ) => unknown[];
  dynamicArray: (
    view: DataView,
    offset: number,
    elementDeser: (view: DataView, offset: number) => unknown,
    elementSize: (view: DataView, offset: number) => number,
  ) => unknown[];
} = {
  bool: (view, offset) => view.getUint8(offset) !== 0,
  int8: (view, offset) => view.getInt8(offset),
  uint8: (view, offset) => view.getUint8(offset),
  int16: (view, offset) => view.getInt16(offset, true),
  uint16: (view, offset) => view.getUint16(offset, true),
  int32: (view, offset) => view.getInt32(offset, true),
  uint32: (view, offset) => view.getUint32(offset, true),
  int64: (view, offset) => view.getBigInt64(offset, true),
  uint64: (view, offset) => view.getBigUint64(offset, true),
  float32: (view, offset) => view.getFloat32(offset, true),
  float64: (view, offset) => view.getFloat64(offset, true),
  time: (view, offset) => {
    const sec = view.getUint32(offset, true);
    const nsec = view.getUint32(offset + 4, true);
    return { sec, nsec };
  },
  duration: (view, offset) => deserializers.time(view, offset),
  string: (view, offset) => {
    const len = view.getInt32(offset, true);
    const totalOffset = view.byteOffset + offset + 4;
    const maxLen = view.byteLength - offset;
    if (len < 0 || len > maxLen) {
      throw new RangeError(`String deserialization error: length ${len}, maxLength ${maxLen}`);
    }
    const codePoints = new Uint8Array(view.buffer, totalOffset, len);

    // For short strings, using fromCharCode is faster then decoder (according to benchmarks)
    if (codePoints.length <= 40) {
      return String.fromCharCode.apply(null, codePoints as unknown as number[]);
    }

    return decoder.decode(codePoints);
  },
  boolArray: (view, offset, len) => {
    let currentOffset = offset;
    const arr = new Array<boolean>(len);
    for (let idx = 0; idx < len; ++idx) {
      arr[idx] = deserializers.bool(view, currentOffset);
      currentOffset += 1;
    }
    return arr;
  },
  int8Array: MakeTypedArrayDeserialze(Int8Array, "getInt8"),
  uint8Array: MakeTypedArrayDeserialze(Uint8Array, "getUint8"),
  int16Array: MakeTypedArrayDeserialze(Int16Array, "getInt16"),
  uint16Array: MakeTypedArrayDeserialze(Uint16Array, "getUint16"),
  int32Array: MakeTypedArrayDeserialze(Int32Array, "getInt32"),
  uint32Array: MakeTypedArrayDeserialze(Uint32Array, "getUint32"),
  int64Array: MakeTypedArrayDeserialze(
    typeof BigInt64Array === "function" ? BigInt64Array : undefined,
    "getBigInt64",
  ),
  uint64Array: MakeTypedArrayDeserialze(
    typeof BigUint64Array === "function" ? BigUint64Array : undefined,
    "getBigUint64",
  ),
  float32Array: MakeTypedArrayDeserialze(Float32Array, "getFloat32"),
  float64Array: MakeTypedArrayDeserialze(Float64Array, "getFloat64"),
  timeArray: (view, offset, len) => {
    let currentOffset = offset;
    // Time and Duration are actually arrays of int32
    // If the location of the TimeArray meets Int32Array aligned access requirements, we can use Int32Array
    // to speed up access to the int32 values.
    // Otherwise we fall back to individual value reading via DataView

    const timeArr = new Array<{ sec: number; nsec: number }>(len);

    const totalOffset = view.byteOffset + currentOffset;
    // aligned access provides for a fast path to typed array construction
    if (totalOffset % Int32Array.BYTES_PER_ELEMENT === 0) {
      const intArr = new Int32Array(view.buffer, totalOffset, len * 2);
      for (let i = 0, j = 0; i < len; ++i, j = j + 2) {
        timeArr[i] = {
          sec: intArr[j] as number,
          nsec: intArr[j + 1] as number,
        };
      }
    } else {
      for (let idx = 0; idx < len; ++idx) {
        timeArr[idx] = {
          sec: view.getInt32(currentOffset, true),
          nsec: view.getInt32(currentOffset + 4, true),
        };
        currentOffset += 8;
      }
    }

    return timeArr;
  },
  durationArray: (view, offset, len) => deserializers.timeArray(view, offset, len),
  fixedArray: (view, offset, len, elementDeser, elementSize) => {
    let currentOffset = offset;
    const arr = new Array<unknown>(len);
    for (let idx = 0; idx < len; ++idx) {
      arr[idx] = elementDeser(view, currentOffset);
      currentOffset += elementSize(view, currentOffset);
    }
    return arr;
  },
  dynamicArray: (view, offset, elementDeser, elementSize) => {
    const len = view.getUint32(offset, true);
    return deserializers.fixedArray(view, offset + 4, len, elementDeser, elementSize);
  },
};
