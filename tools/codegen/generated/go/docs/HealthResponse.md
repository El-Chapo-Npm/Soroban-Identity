# HealthResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | **string** |  | 
**ApiVersion** | Pointer to **string** |  | [optional] 
**SupportedVersions** | Pointer to **[]string** |  | [optional] 
**DeprecatedVersions** | Pointer to **[]string** |  | [optional] 
**DefaultVersion** | Pointer to **string** |  | [optional] 
**Contracts** | **map[string]bool** |  | 
**CircuitBreaker** | **map[string]interface{}** |  | 

## Methods

### NewHealthResponse

`func NewHealthResponse(status string, contracts map[string]bool, circuitBreaker map[string]interface{}, ) *HealthResponse`

NewHealthResponse instantiates a new HealthResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewHealthResponseWithDefaults

`func NewHealthResponseWithDefaults() *HealthResponse`

NewHealthResponseWithDefaults instantiates a new HealthResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *HealthResponse) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *HealthResponse) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *HealthResponse) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetApiVersion

`func (o *HealthResponse) GetApiVersion() string`

GetApiVersion returns the ApiVersion field if non-nil, zero value otherwise.

### GetApiVersionOk

`func (o *HealthResponse) GetApiVersionOk() (*string, bool)`

GetApiVersionOk returns a tuple with the ApiVersion field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetApiVersion

`func (o *HealthResponse) SetApiVersion(v string)`

SetApiVersion sets ApiVersion field to given value.

### HasApiVersion

`func (o *HealthResponse) HasApiVersion() bool`

HasApiVersion returns a boolean if a field has been set.

### GetSupportedVersions

`func (o *HealthResponse) GetSupportedVersions() []string`

GetSupportedVersions returns the SupportedVersions field if non-nil, zero value otherwise.

### GetSupportedVersionsOk

`func (o *HealthResponse) GetSupportedVersionsOk() (*[]string, bool)`

GetSupportedVersionsOk returns a tuple with the SupportedVersions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportedVersions

`func (o *HealthResponse) SetSupportedVersions(v []string)`

SetSupportedVersions sets SupportedVersions field to given value.

### HasSupportedVersions

`func (o *HealthResponse) HasSupportedVersions() bool`

HasSupportedVersions returns a boolean if a field has been set.

### GetDeprecatedVersions

`func (o *HealthResponse) GetDeprecatedVersions() []string`

GetDeprecatedVersions returns the DeprecatedVersions field if non-nil, zero value otherwise.

### GetDeprecatedVersionsOk

`func (o *HealthResponse) GetDeprecatedVersionsOk() (*[]string, bool)`

GetDeprecatedVersionsOk returns a tuple with the DeprecatedVersions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDeprecatedVersions

`func (o *HealthResponse) SetDeprecatedVersions(v []string)`

SetDeprecatedVersions sets DeprecatedVersions field to given value.

### HasDeprecatedVersions

`func (o *HealthResponse) HasDeprecatedVersions() bool`

HasDeprecatedVersions returns a boolean if a field has been set.

### GetDefaultVersion

`func (o *HealthResponse) GetDefaultVersion() string`

GetDefaultVersion returns the DefaultVersion field if non-nil, zero value otherwise.

### GetDefaultVersionOk

`func (o *HealthResponse) GetDefaultVersionOk() (*string, bool)`

GetDefaultVersionOk returns a tuple with the DefaultVersion field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDefaultVersion

`func (o *HealthResponse) SetDefaultVersion(v string)`

SetDefaultVersion sets DefaultVersion field to given value.

### HasDefaultVersion

`func (o *HealthResponse) HasDefaultVersion() bool`

HasDefaultVersion returns a boolean if a field has been set.

### GetContracts

`func (o *HealthResponse) GetContracts() map[string]bool`

GetContracts returns the Contracts field if non-nil, zero value otherwise.

### GetContractsOk

`func (o *HealthResponse) GetContractsOk() (*map[string]bool, bool)`

GetContractsOk returns a tuple with the Contracts field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetContracts

`func (o *HealthResponse) SetContracts(v map[string]bool)`

SetContracts sets Contracts field to given value.


### GetCircuitBreaker

`func (o *HealthResponse) GetCircuitBreaker() map[string]interface{}`

GetCircuitBreaker returns the CircuitBreaker field if non-nil, zero value otherwise.

### GetCircuitBreakerOk

`func (o *HealthResponse) GetCircuitBreakerOk() (*map[string]interface{}, bool)`

GetCircuitBreakerOk returns a tuple with the CircuitBreaker field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCircuitBreaker

`func (o *HealthResponse) SetCircuitBreaker(v map[string]interface{})`

SetCircuitBreaker sets CircuitBreaker field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


