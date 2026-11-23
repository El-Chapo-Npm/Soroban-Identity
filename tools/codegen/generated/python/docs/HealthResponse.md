# HealthResponse


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**status** | **str** |  | 
**api_version** | **str** |  | [optional] 
**supported_versions** | **List[str]** |  | [optional] 
**deprecated_versions** | **List[str]** |  | [optional] 
**default_version** | **str** |  | [optional] 
**contracts** | **Dict[str, bool]** |  | 
**circuit_breaker** | **object** |  | 

## Example

```python
from soroban_identity_client.models.health_response import HealthResponse

# TODO update the JSON string below
json = "{}"
# create an instance of HealthResponse from a JSON string
health_response_instance = HealthResponse.from_json(json)
# print the JSON string representation of the object
print(HealthResponse.to_json())

# convert the object into a dict
health_response_dict = health_response_instance.to_dict()
# create an instance of HealthResponse from a dict
health_response_from_dict = HealthResponse.from_dict(health_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


