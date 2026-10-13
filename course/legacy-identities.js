// 旧67問の照合用メタデータ。問題本文は持たず、自動登録もしない。
// 原本: packs/archive/*.json。tools/build-legacy-identities.cjs で再生成する。
const LegacyQuestionIdentities = Object.freeze(Object.fromEntries(
  Object.entries({
  "jintai-001": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "d092a8f0fd6e7c0eb95ebe7d3c04cae49f1cfab73deb502700b739a925f1171d"
  },
  "jintai-002": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "fd5c99d85e369c5e96a6bd13ee99d9c8e8640314fca294b262d6fc72f82d46db"
  },
  "jintai-003": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "2fde911f7ee459dc045911e37d01145265c634b5ac8ce116d2362b796073547c"
  },
  "jintai-004": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "5f62730459e26c9f8200d09d2bee7c35b8f5573638cd32f600206499beb594bd"
  },
  "jintai-005": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "af6379b75a0de971b6bdd713872a1cd509fb7fc9f7d8273ba0454f5a9f002c5e"
  },
  "jintai-006": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "415cf237818034b947b7facc6ffabefbb9418250c858238d7a93eba040011cb4"
  },
  "jintai-007": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "cbc9174c80160fc736541c614bb4782a5dab9730a2e8997d940f72b2fb79cf92"
  },
  "jintai-008": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "d5415515078347a02ba83e47f64b1bdd4a3cded837f8e6f1ca718486138f75a4"
  },
  "jintai-009": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "53b0a73962e1f5e1ba1d1be2e503e72284d99a30246a04a5b7cc04c57bf3cccd"
  },
  "jintai-010": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "112da0a90e6e5cb693ac48bdec1edfb2fa609a7c836143c1668e874f132f09fc"
  },
  "jintai-012": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "9d90a0391c84f41a4b808186ad0349dd4b976502fc122d0b6b33f9435439cf02"
  },
  "jintai-013": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "0896ce4c74f529c7fcebb6bac2a6d61a2947ebc277400017a52067dfba180c1b"
  },
  "jintai-014": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "2fcc538e6fcc1b4258a26c4acd47b939aa2e19a6888754b5c8e8cb0b2c11843f"
  },
  "jintai-015": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "82b14c10f07bd96e471b32ea7a1109982f3fcd1ab50724ecf2dc86d2299bc910"
  },
  "jintai-016": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "0694dad83a557f5cfaf86e98d4ff2fb6fa33e9049f5c6bb6ad937f0dea6669b3"
  },
  "jintai-017": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "9b793154c1efa0d86305254940731edb2a4460a5d7d68538901ec2362e72921e"
  },
  "jintai-018": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "fed748f5392cfe831dcd5a22e149f0244d3fbe30fc8830ed5003c64e62bd6702"
  },
  "jintai-019": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "3dded357582cda86c73a04717344b6b77ee5d4eac9b6cdc5d95e00c3a316d9fc"
  },
  "jintai-020": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "e5bae403ec9816dfbef236b540177de0e02272e022694ece74597c40e4860096"
  },
  "jintai-021": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "7adb6ac9eca0890efb86eb402b9a9efe5c0ea518918df6ee0c28895c74bbb99f"
  },
  "jintai-022": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "19974cbe7f4ad2eb3266a02080f20ddfde9a8e71baa3d20f53ff7fc6e1ba4cd8"
  },
  "jintai-023": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "317dceac7022fb62a6254f0e5f1daeb71100d432a64f791a37397661d26d8644"
  },
  "jintai-024": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "f9c981122b11e4099d0d0b1cea4bf703742ed4da4021b123053e57eb0765ef8c"
  },
  "jintai-025": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "a1b6df1d40e2edac4df047272a3b66ddb6f2367f58f35df655c752b9f080332a"
  },
  "jintai-026": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "72b287ed021133c4d38eab951a5e30a4d6ca88f6330c9ab1a87318d91d861828"
  },
  "jintai-027": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "f0e23bcf2773fea86d4c88295e13cb25d3b7cd7b376db3efb7c0b251683c6e11"
  },
  "jintai-028": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "88a257027ce5e4253dc5b31a266bfdede13013a1366a71772b0cd1b1ea9828f2"
  },
  "jintai-029": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "598db48249891705435743bcacd10d6b0704b6c4c5bd410f2b6f0035456bbc03"
  },
  "jintai-030": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "b2f40f7738659f2764d38acdb7919eaffe5367f44b73a016898c7372ad4e71ec"
  },
  "jintai-031": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "9cd6c1b1dfd27d3a8a4cb3b2e2350916dcc859abbe408193a2f02a8e7171542b"
  },
  "jintai-032": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "72dea19e323be200160467bd7f53fdb32ea767a5c7c9f8f68d380d85a624e44d"
  },
  "jintai-033": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "4c0539916bdcc346677b0ea2a81f0e869ad051db7cc36154be118e38146e7d8d"
  },
  "jintai-034": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "bb28db0df3b32323e241bf3d5e87ca9a348305a6dbe9036fdac2d565ed010a5e"
  },
  "jintai-035": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "dcde0227ccb60a0b976bb84b7c0837c9a0573f8278c02a765e337e2878419075"
  },
  "jintai-036": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "e2de2c5e743ab020634a99591c398b3e048db57f76bc785a43fc090c788dce92"
  },
  "jintai-037": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "21fb3fc78b757e690247a2ae8ebca779eb755dc149eab315c63b374c6aa5d0d5"
  },
  "jintai-038": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "819f948801603418f7125f930c22cdbbd01ea2d968e111334dc5c1e75f8d7864"
  },
  "jintai-039": {
    "subject": "人体の構造と機能・疾病",
    "sha256": "6d400f23829eb968978ac38c1d343f27e4e0911ee0e345ce70bd32f83e3eac3b"
  },
  "rinsho-001": {
    "subject": "臨床心理学概論",
    "sha256": "15792571ac8af9ec760b0c11eb91c113c43d403dab31e864d7e555d141cad8fd"
  },
  "rinsho-003": {
    "subject": "臨床心理学概論",
    "sha256": "6aab033d00c0d7723a7cedb2a36d7a5c4524570a5a121a73d1c0b647b9203ded"
  },
  "rinsho-004": {
    "subject": "臨床心理学概論",
    "sha256": "56b77534c4a27bd7650ed571b4d778aca67e5b3f2dc3d92df4346afc4463a54e"
  },
  "rinsho-005": {
    "subject": "臨床心理学概論",
    "sha256": "4a18118cb2037b52c3bb32eb614b51938258ab51fef074e4146ae0b8b4d0e5e1"
  },
  "rinsho-006": {
    "subject": "臨床心理学概論",
    "sha256": "d526978fdd7de6658f31da56992004c5751cebcf1b62316547a92cf0c44414ed"
  },
  "rinsho-007": {
    "subject": "臨床心理学概論",
    "sha256": "2f6f52a2c3cbdcc4369e8eefb56b384633d406215af75ffd896a5beef312a94f"
  },
  "rinsho-008": {
    "subject": "臨床心理学概論",
    "sha256": "da2369803feb7c6155a8fb4ad5ef10cd0a2ed51e89272498c55da808958808e2"
  },
  "rinsho-009": {
    "subject": "臨床心理学概論",
    "sha256": "ac7082464c5c2e4726d741322f04be18005f82128e6e5b4b60fdd7ebc4c2b09e"
  },
  "rinsho-010": {
    "subject": "臨床心理学概論",
    "sha256": "91198a8b5a2cef60046cb26871e2653afa00edd0738116f0466298fa9fd64e2c"
  },
  "rinsho-011": {
    "subject": "臨床心理学概論",
    "sha256": "5acecc503eb4b8c0415838c9c593683f23bbb0d6b18a173e90e7296a5704ec78"
  },
  "rinsho-012": {
    "subject": "臨床心理学概論",
    "sha256": "cb6e86bfa8e171800a17e8cf8173574493631e5fe2287657b161ea9cd1295064"
  },
  "rinsho-013": {
    "subject": "臨床心理学概論",
    "sha256": "311915321454b1406ba52c984b78f6e5a6c8e5a9a746d8748fe73ebb4c899517"
  },
  "rinsho-014": {
    "subject": "臨床心理学概論",
    "sha256": "ab80346dcfb0fdfff325036461969c298f10cebc61f28b86d38eccd7ed13f674"
  },
  "rinsho-015": {
    "subject": "臨床心理学概論",
    "sha256": "c49de21d70ab9252a8a925db8959d71ea840167c0535572f220f85c18e2c6691"
  },
  "rinsho-016": {
    "subject": "臨床心理学概論",
    "sha256": "2ee65600a6a60797b76a0a0c423474e08e77761cbe4f35ec3f81630164304192"
  },
  "rinsho-017": {
    "subject": "臨床心理学概論",
    "sha256": "cdc175fab6ed23af43ea5614073d8dc3e496998be1605e358089d4e34fe914a6"
  },
  "rinsho-018": {
    "subject": "臨床心理学概論",
    "sha256": "69a9b7a6ddd8430909928c26b11f89d376db39de6f5d4aee1796ac5a7a472847"
  },
  "rinsho-019": {
    "subject": "臨床心理学概論",
    "sha256": "f4cdbbacd10d78163566b7f62f1421487394943bb2de3d7d466b34c6b7e6095c"
  },
  "rinsho-020": {
    "subject": "臨床心理学概論",
    "sha256": "26082128b4819e4e64a9472ec62f52cc15f11492bfccd13a490da77db418879e"
  },
  "rinsho-021": {
    "subject": "臨床心理学概論",
    "sha256": "e8cfb294de23c2f6504972d18fd46b189767c7d07d54a5d9fa06b89c0ee13331"
  },
  "rinsho-022": {
    "subject": "臨床心理学概論",
    "sha256": "5d89894512982b391d3837ddad99e13382e9dbdef351de67bb8a7e4906c4697a"
  },
  "rinsho-023": {
    "subject": "臨床心理学概論",
    "sha256": "5501650a2184b13ff03e2d8ef2b37993210916331dca2c2c7b0cc9776f341646"
  },
  "rinsho-024": {
    "subject": "臨床心理学概論",
    "sha256": "1cf94da377f8c299689be9a49088d94d91f814204264b2c879dadf6d5855e16c"
  },
  "rinsho-025": {
    "subject": "臨床心理学概論",
    "sha256": "27c51b13d981c2717c96bea9e3d41d1d38e4786a136afd2b4af6c242d8bfde2f"
  },
  "rinsho-026": {
    "subject": "臨床心理学概論",
    "sha256": "4e1cf4841e73a9013300961743faf71c3535a81674163f1410f6833025bd71ff"
  },
  "rinsho-027": {
    "subject": "臨床心理学概論",
    "sha256": "5cc1afdf7abd2bf10aa34b43e7679d271bd9e13bab0a596ee1a105e0615631da"
  },
  "rinsho-028": {
    "subject": "臨床心理学概論",
    "sha256": "f7cf3bf236dc095cb417bf0bd92de5db18d6268ac91b8dc6c3cb86d752cc4bf0"
  },
  "rinsho-029": {
    "subject": "臨床心理学概論",
    "sha256": "23267e1425a8e85aa9f0804a9bfb94a3d48c89b2817d9b00eece5719ad6f292a"
  },
  "rinsho-030": {
    "subject": "臨床心理学概論",
    "sha256": "9c6109bc82eee884d897b912ee006bab63c0765bc69e23c13d92025f2470c44b"
  }
}).map(([id, value]) => [id, Object.freeze(value)])
));
