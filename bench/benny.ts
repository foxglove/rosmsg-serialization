import { parse } from "@foxglove/rosmsg";
import benny from "benny";

import { LazyMessageReader, MessageReader, MessageWriter } from "../src";

type Testcase = {
  name: string;
  msgDef: string;
  msg: unknown;
  lastField: (msg: unknown) => void;
};

async function makeSuite(testCase: Testcase): Promise<void> {
  const name = testCase.name;
  const msgDefStr = testCase.msgDef;
  const messageDefinition = parse(msgDefStr);

  const writer = new MessageWriter(messageDefinition);
  const msgData = writer.writeMessage(testCase.msg);
  const lastField = testCase.lastField;

  await benny.suite(
    `${name} - new reader`,

    benny.add("Reg", () => {
      new MessageReader(messageDefinition);
    }),

    benny.add("Lazy", () => {
      new LazyMessageReader(messageDefinition);
    }),

    benny.cycle(),
    benny.complete(),
  );

  await benny.suite(
    `${name} - read message`,

    benny.add("Reg", () => {
      const messageReader = new MessageReader(messageDefinition);
      return () => {
        messageReader.readMessage(msgData);
      };
    }),

    benny.add("Lazy", () => {
      const messageReader = new LazyMessageReader(messageDefinition);
      return () => {
        messageReader.readMessage(msgData);
      };
    }),

    benny.add("Lazy - w/toJSON", () => {
      const messageReader = new LazyMessageReader(messageDefinition);
      return () => {
        const msg = messageReader.readMessage(msgData);
        msg.toJSON();
      };
    }),

    benny.cycle(),
    benny.complete(),
  );

  await benny.suite(
    `${name} - read last field`,

    benny.add("Reg", () => {
      const messageReader = new MessageReader(messageDefinition);
      return () => {
        // for regular message reading the last field can only be accessed once the message is read
        const msg = messageReader.readMessage(msgData);
        lastField(msg);
      };
    }),

    benny.add("Lazy", () => {
      const messageReader = new LazyMessageReader(messageDefinition);
      return () => {
        const msg = messageReader.readMessage(msgData);
        lastField(msg);
      };
    }),

    benny.cycle(),
    benny.complete(),
  );

  console.log("---------------------------------------");
}

async function main() {
  await makeSuite({
    name: "int8 array",
    lastField: (msg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      void (msg as any).arr[99999];
    },
    msgDef: `int8[] arr`,
    msg: {
      arr: new Int8Array(100000).fill(3),
    },
  });

  await makeSuite({
    name: "float32 array",
    lastField: (msg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      void (msg as any).arr[99999];
    },
    msgDef: `float32[] arr`,
    msg: {
      arr: new Float32Array(100000).fill(3),
    },
  });

  await makeSuite({
    name: "std_msgs/Header",
    lastField: (msg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      void (msg as any).frame_id;
    },
    msgDef: `
      uint32 seq
      time stamp
      string frame_id
    `,
    msg: {
      seq: 0,
      stamp: { sec: 0, nsec: 0 },
      frame_id: "frame id",
    },
  });

  await makeSuite({
    name: "sensor_msgs/PointCloud2",
    lastField: (msg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      void (msg as any).is_dense;
    },
    msgDef: `
        Header header
        uint32 height
        uint32 width
        PointField[] fields
        bool    is_bigendian
        uint32  point_step
        uint32  row_step
        uint8[] data
        bool is_dense
        ===================
        MSG: std_msgs/Header
        uint32 seq
        time stamp
        string frame_id
        ===================
        MSG: sensor_msgs/PointField
        string name
        uint32 offset
        uint8  datatype
        uint32 count
          `,
    msg: {
      header: {
        seq: 0,
        stamp: { sec: 0, nsec: 0 },
        frame_id: "frame id",
      },
      height: 100,
      width: 100,
      fields: [
        { name: "field 1", offset: 0, datatype: 0, count: 0 },
        { name: "field 2", offset: 0, datatype: 0, count: 0 },
        { name: "field 3", offset: 0, datatype: 0, count: 0 },
        { name: "field 4", offset: 0, datatype: 0, count: 0 },
      ],
      is_bigendian: false,
      point_step: 0,
      row_step: 0,
      data: new Uint8Array(1000000).fill(0),
      is_dense: false,
    },
  });

  await makeSuite({
    name: "diagnostic_msgs/DiagnosticArray",
    lastField: (msg) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      void (msg as any).status[19].values[19].value;
    },
    msgDef: `
    Header header
    DiagnosticStatus[] status
    ======================
    MSG: std_msgs/Header
    uint32 seq
    time stamp
    string frame_id
    ================
    MSG: misc/DiagnosticStatus
    byte level
    string name
    string message
    string hardware_id
    KeyValue[] values
    ================
    MSG: misc/KeyValue
    string key
    string value
    `,
    msg: {
      header: {
        seq: 0,
        stamp: { sec: 0, nsec: 0 },
        frame_id: "frame id",
      },
      status: new Array(20).fill({
        level: 0,
        name: "some name",
        message: "some message usually longer",
        hardware_id: "some hardware id",
        values: new Array(20).fill({ key: "a key", value: "some value" }),
      }),
    },
  });
}

void main();
