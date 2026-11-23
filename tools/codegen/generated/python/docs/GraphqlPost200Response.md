# GraphqlPost200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**data** | **object** |  | [optional] 
**errors** | **List[object]** |  | [optional] 

## Example

```python
from soroban_identity_client.models.graphql_post200_response import GraphqlPost200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GraphqlPost200Response from a JSON string
graphql_post200_response_instance = GraphqlPost200Response.from_json(json)
# print the JSON string representation of the object
print(GraphqlPost200Response.to_json())

# convert the object into a dict
graphql_post200_response_dict = graphql_post200_response_instance.to_dict()
# create an instance of GraphqlPost200Response from a dict
graphql_post200_response_from_dict = GraphqlPost200Response.from_dict(graphql_post200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


