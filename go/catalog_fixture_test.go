package yir

// Static facts are explicit test input, not a runtime admission dependency.
func testModelContracts() *ModelContractCatalog {
	catalog := bundledModelContractCatalog
	catalog.Version = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	return &catalog
}
