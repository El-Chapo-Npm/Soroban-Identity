# ServerInfo

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Version** | **string** |  | 
**ApiVersion** | Pointer to **string** |  | [optional] 
**SupportedVersions** | Pointer to **[]string** |  | [optional] 
**Features** | **[]string** |  | 
**MinSdkVersion** | **string** |  | 

## Methods

### NewServerInfo

`func NewServerInfo(version string, features []string, minSdkVersion string, ) *ServerInfo`

NewServerInfo instantiates a new ServerInfo object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewServerInfoWithDefaults

`func NewServerInfoWithDefaults() *ServerInfo`

NewServerInfoWithDefaults instantiates a new ServerInfo object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetVersion

`func (o *ServerInfo) GetVersion() string`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *ServerInfo) GetVersionOk() (*string, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *ServerInfo) SetVersion(v string)`

SetVersion sets Version field to given value.


### GetApiVersion

`func (o *ServerInfo) GetApiVersion() string`

GetApiVersion returns the ApiVersion field if non-nil, zero value otherwise.

### GetApiVersionOk

`func (o *ServerInfo) GetApiVersionOk() (*string, bool)`

GetApiVersionOk returns a tuple with the ApiVersion field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetApiVersion

`func (o *ServerInfo) SetApiVersion(v string)`

SetApiVersion sets ApiVersion field to given value.

### HasApiVersion

`func (o *ServerInfo) HasApiVersion() bool`

HasApiVersion returns a boolean if a field has been set.

### GetSupportedVersions

`func (o *ServerInfo) GetSupportedVersions() []string`

GetSupportedVersions returns the SupportedVersions field if non-nil, zero value otherwise.

### GetSupportedVersionsOk

`func (o *ServerInfo) GetSupportedVersionsOk() (*[]string, bool)`

GetSupportedVersionsOk returns a tuple with the SupportedVersions field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSupportedVersions

`func (o *ServerInfo) SetSupportedVersions(v []string)`

SetSupportedVersions sets SupportedVersions field to given value.

### HasSupportedVersions

`func (o *ServerInfo) HasSupportedVersions() bool`

HasSupportedVersions returns a boolean if a field has been set.

### GetFeatures

`func (o *ServerInfo) GetFeatures() []string`

GetFeatures returns the Features field if non-nil, zero value otherwise.

### GetFeaturesOk

`func (o *ServerInfo) GetFeaturesOk() (*[]string, bool)`

GetFeaturesOk returns a tuple with the Features field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetFeatures

`func (o *ServerInfo) SetFeatures(v []string)`

SetFeatures sets Features field to given value.


### GetMinSdkVersion

`func (o *ServerInfo) GetMinSdkVersion() string`

GetMinSdkVersion returns the MinSdkVersion field if non-nil, zero value otherwise.

### GetMinSdkVersionOk

`func (o *ServerInfo) GetMinSdkVersionOk() (*string, bool)`

GetMinSdkVersionOk returns a tuple with the MinSdkVersion field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMinSdkVersion

`func (o *ServerInfo) SetMinSdkVersion(v string)`

SetMinSdkVersion sets MinSdkVersion field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


